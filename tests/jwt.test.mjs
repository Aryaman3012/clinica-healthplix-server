import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, clinicIdFromJwt } from '../src/jwt.js';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (claims) => `aaa.${b64url(claims)}.bbb`;

test('decodeJwt: valid token returns claims', () => {
  const claims = { clinic_id: 'c1', exp: 1893456000 };
  assert.deepEqual(decodeJwt(makeJwt(claims)), claims);
});

test('decodeJwt: malformed token returns null', () => {
  assert.equal(decodeJwt('nope'), null);
  assert.equal(decodeJwt(''), null);
});

test('clinicIdFromJwt: prefers clinic_id, falls back through aliases to sub', () => {
  assert.equal(clinicIdFromJwt(makeJwt({ clinic_id: 'c1' })), 'c1');
  assert.equal(clinicIdFromJwt(makeJwt({ clinicId: 'c2' })), 'c2');
  assert.equal(clinicIdFromJwt(makeJwt({ org_id: 'c3' })), 'c3');
  assert.equal(clinicIdFromJwt(makeJwt({ sub: 'c4' })), 'c4');
  assert.equal(clinicIdFromJwt(makeJwt({ unrelated: 'x' })), null);
});
