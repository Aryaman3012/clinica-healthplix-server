// Minimal CouchDB credential store over fetch (no extra deps; swap for `nano` if preferred).
//
// Document shape (type: 'healthplix_credentials'):
//   {
//     _id, _rev,
//     type: 'healthplix_credentials',
//     clinicId,                 // primary key (from the Clinica JWT)
//     accountId,                // HealthPlix branch/account id
//     healthplix: { token, doctorId, doctorRoleId, branchId, branchName, doctorName, exp },
//     clinicaStreamToken,       // token from clinica-portal /api/practo/register
//     revoked: boolean,
//     updatedAt: ISO string
//   }

import { config } from './config.js';

const base = `${config.couchUrl}/${config.couchDb}`;

async function couch(method, path = '', body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CouchDB ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Create the database if it doesn't exist. Call once at boot.
export async function ensureDb() {
  const res = await fetch(base, { method: 'PUT' });
  if (!res.ok && res.status !== 412 /* already exists */) {
    throw new Error(`CouchDB create db → ${res.status}: ${await res.text()}`);
  }
}

const docId = (clinicId) => `healthplix:creds:${clinicId}`;

export async function getCredentials(clinicId) {
  return couch('GET', `/${encodeURIComponent(docId(clinicId))}`);
}

export async function upsertCredentials(clinicId, patch) {
  const existing = await getCredentials(clinicId);
  const doc = {
    ...(existing ?? {}),
    _id: docId(clinicId),
    type: 'healthplix_credentials',
    clinicId,
    ...patch,
    revoked: false,
    updatedAt: new Date().toISOString(),
  };
  if (existing?._rev) doc._rev = existing._rev;
  const r = await couch('PUT', `/${encodeURIComponent(doc._id)}`, doc);
  return { ...doc, _rev: r.rev };
}

export async function revokeCredentials(clinicId) {
  const existing = await getCredentials(clinicId);
  if (!existing) return null;
  existing.revoked = true;
  existing.updatedAt = new Date().toISOString();
  const r = await couch('PUT', `/${encodeURIComponent(existing._id)}`, existing);
  return { ...existing, _rev: r.rev };
}

// All live (non-revoked) credential docs — used at boot to resume SSE consumers.
export async function listActiveCredentials() {
  const r = await couch('POST', '/_find', {
    selector: { type: 'healthplix_credentials', revoked: false },
    limit: 10000,
  });
  return r?.docs ?? [];
}
