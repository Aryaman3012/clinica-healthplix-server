import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentDates, clinicaPatientToAddBody } from '../src/healthplix/client.js';

test('recentDates: inclusive IST window with injected now', () => {
  // 2026-07-01T00:00:00Z → IST 05:30 same day.
  const now = Date.parse('2026-07-01T00:00:00Z');
  const dates = recentDates(1, 2, now);
  assert.deepEqual(dates, ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']);
  assert.equal(dates.length, 1 + 1 + 2);
});

test('recentDates: IST offset rolls late-UTC into next IST day', () => {
  // 2026-07-01T20:00:00Z + 5:30 = 2026-07-02 01:30 IST.
  const now = Date.parse('2026-07-01T20:00:00Z');
  assert.deepEqual(recentDates(0, 0, now), ['2026-07-02']);
});

const HP = { doctorId: '5126673344', doctorRoleId: '5126699479', branchId: '217306', token: 'JWT' };

test('clinicaPatientToAddBody: maps core fields + injects doctor/branch/token', () => {
  const body = clinicaPatientToAddBody(
    { name: 'Anaya', phone: '7868423475', gender: 'female', city: 'Anantapur', pincode: 121001 },
    HP,
  );
  assert.equal(body.name, 'Anaya');
  assert.equal(body.phone, '7868423475');
  assert.equal(body.gender, 'F');
  assert.equal(body.city, 'Anantapur');
  assert.equal(body.pincode, '121001'); // coerced to string
  assert.equal(body.doctor_id, '5126673344');
  assert.equal(body.doctor_role_id, '5126699479');
  assert.equal(body.org_branch_id, '217306');
  assert.equal(body.source, 'emr');
  assert.equal(body.token, 'JWT');
  assert.deepEqual(body.custom_fields, []);
});

test('clinicaPatientToAddBody: tolerates alternate field names + missing values', () => {
  const body = clinicaPatientToAddBody({ full_name: 'X', mobile: '999', sex: 'M' }, HP);
  assert.equal(body.name, 'X');
  assert.equal(body.phone, '999');
  assert.equal(body.gender, 'M');
  assert.equal(body.email, ''); // absent → empty
  assert.equal(body.phone.length, 3);
});
