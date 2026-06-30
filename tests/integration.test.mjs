// Server integration tests.
//
// - Embedded FAKE clinica-portal (register/stream/ack) so we never hit the real portal.
// - REAL CouchDB, but a throwaway `<db>_inttest` database that is dropped afterwards, so
//   prod data is never touched. CouchDB-dependent tests skip if no CouchDB is reachable.
//
// Run:  COUCHDB_URL=http://admin:password@localhost:5984 node --test
//
// The fake portal + env must be set BEFORE importing our config-bound modules, so all
// server modules are loaded via dynamic import after setup.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (claims) => `aaa.${b64url(claims)}.bbb`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg = 'timeout') =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// --- Fake clinica-portal -------------------------------------------------------------

const fakeState = { registers: [], acks: [], streamConnections: 0 };

function startFakePortal() {
  const server = http.createServer((req, res) => {
    const { method, url } = req;

    if (method === 'POST' && url === '/api/practo/register') {
      const auth = req.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        fakeState.registers.push({ token });
        if (token === 'INVALID') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { token: 'stream-tok-1', alreadyLinked: false } }));
      });
      return;
    }

    if (method === 'GET' && url.startsWith('/api/practo/stream/')) {
      fakeState.streamConnections++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      // Emit one appointment event shortly after connect, then hold the connection open.
      setTimeout(() => {
        res.write(`event: appointment.upserted\nid: evt-1\ndata: ${JSON.stringify({ data: { patient: 'p1' } })}\n\n`);
      }, 30);
      return; // never end → stays open until client aborts
    }

    if (method === 'POST' && url.startsWith('/api/practo/ack/')) {
      const [, , , , token, id] = url.split('/');
      fakeState.acks.push({ token, id });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }

    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
  });
}

// --- Setup: start fake portal, set env, dynamic-import server modules -----------------

const fake = await startFakePortal();
process.env.CLINICA_PORTAL_URL = fake.url;
process.env.COUCHDB_DB = 'healthplix_credentials_inttest';
process.env.COUCHDB_URL = process.env.COUCHDB_URL || 'http://admin:password@localhost:5984';
process.env.INTAKE_KEY = 'test-intake-key';

const { config } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');
const { ensureDb, getCredentials, getPending } = await import('../src/db.js');
const { StreamConsumer } = await import('../src/clinica/stream.js');
const { ensureConsumer, stopConsumer } = await import('../src/manager.js');

async function couchReachable() {
  try {
    const r = await fetch(config.couchUrl);
    return r.ok;
  } catch {
    return false;
  }
}
const HAVE_COUCH = await couchReachable();

after(async () => {
  fake.server.close();
  if (HAVE_COUCH) {
    await fetch(`${config.couchUrl}/${config.couchDb}`, { method: 'DELETE' }).catch(() => {});
  }
});

// --- Test 1: SSE consumer end-to-end (no CouchDB needed) ------------------------------

test('StreamConsumer receives an SSE event and acks it', async () => {
  const received = [];
  let resolveGot;
  const got = new Promise((r) => (resolveGot = r));

  const consumer = new StreamConsumer('clinicSSE', 'stream-tok-1', async (type, payload) => {
    received.push({ type, payload });
    resolveGot();
  });
  consumer.start();

  await withTimeout(got, 3000, 'never received SSE event');
  await delay(100); // let the ack POST land
  consumer.stop();

  assert.equal(received[0].type, 'appointment.upserted');
  assert.deepEqual(received[0].payload, { data: { patient: 'p1' } });
  assert.ok(fakeState.acks.find((a) => a.id === 'evt-1'), 'event was acked on the fake portal');
});

// --- Test 2: credential route lifecycle (needs CouchDB) ------------------------------

test(
  'POST /v1/credentials validates via portal, persists to CouchDB; DELETE revokes',
  { skip: HAVE_COUCH ? false : 'no CouchDB reachable (set COUCHDB_URL)' },
  async () => {
    await ensureDb();
    const server = createApp().listen(0);
    after(() => server.close());
    const baseUrl = `http://localhost:${server.address().port}`;
    const jwt = makeJwt({ clinic_id: 'clinicInt1' });
    const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
    const creds = JSON.stringify({ healthplix: { token: 'hp.jwt.tok', branchId: 'b1', doctorRoleId: 'dr1' } });

    // valid push → 200 + persisted
    let res = await fetch(`${baseUrl}/v1/credentials`, { method: 'POST', headers: auth(jwt), body: creds });
    assert.equal(res.status, 200);

    const doc = await getCredentials('clinicInt1');
    assert.ok(doc, 'credential doc created');
    assert.equal(doc.healthplix.token, 'hp.jwt.tok');
    assert.equal(doc.clinicaStreamToken, 'stream-tok-1');
    assert.equal(doc.revoked, false);

    // invalid Clinica JWT → portal returns 401 → route returns 401
    res = await fetch(`${baseUrl}/v1/credentials`, { method: 'POST', headers: auth('INVALID'), body: creds });
    assert.equal(res.status, 401);

    // status endpoint reflects the link
    res = await fetch(`${baseUrl}/v1/credentials/status`, { headers: auth(jwt) });
    assert.equal((await res.json()).healthplixLinked, true);

    // delete → 200 + revoked
    res = await fetch(`${baseUrl}/v1/credentials`, { method: 'DELETE', headers: auth(jwt) });
    assert.equal(res.status, 200);
    assert.equal((await getCredentials('clinicInt1')).revoked, true);

    stopConsumer('clinicInt1');
  },
);

// --- Test 3: intake fallback gate (no CouchDB needed for the reject paths) ------------

test('intake fallback rejects without the shared key', async () => {
  const server = createApp().listen(0);
  after(() => server.close());
  const baseUrl = `http://localhost:${server.address().port}`;
  const body = JSON.stringify({ healthplix: { token: 'hp.tok', branchId: 'b9' } });

  // no key → 401
  let res = await fetch(`${baseUrl}/v1/intake/credentials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  assert.equal(res.status, 401);

  // wrong key → 401
  res = await fetch(`${baseUrl}/v1/intake/credentials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': 'nope' }, body,
  });
  assert.equal(res.status, 401);
});

test(
  'intake fallback stores a pending doc with the correct key',
  { skip: HAVE_COUCH ? false : 'no CouchDB reachable (set COUCHDB_URL)' },
  async () => {
    await ensureDb();
    const server = createApp().listen(0);
    after(() => server.close());
    const baseUrl = `http://localhost:${server.address().port}`;

    const res = await fetch(`${baseUrl}/v1/intake/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Intake-Key': 'test-intake-key' },
      body: JSON.stringify({ healthplix: { token: 'hp.pending.tok', branchId: 'bPending' } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).pending, true);

    const pending = await getPending('bPending');
    assert.ok(pending, 'pending doc created');
    assert.equal(pending.healthplix.token, 'hp.pending.tok');
    assert.equal(pending.linked, false);
  },
);
