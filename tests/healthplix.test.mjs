import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recentDates, monthWindow, clinicaPatientToAddBody, clinicaAppointmentToBody,
} from '../src/healthplix/client.js';

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

test('monthWindow: ±1 month around onboarding, matches the July→June/Aug example', () => {
  const w = monthWindow('2026-07-01T15:48:40', 1);
  assert.equal(w[0], '2026-06-01');
  assert.equal(w[w.length - 1], '2026-08-01');
  assert.ok(w.includes('2026-07-01'));
  assert.equal(w.length, 62); // Jun(30) + Jul(31) + Aug 1
});

test('monthWindow: ±2 months widens symmetrically', () => {
  const w = monthWindow('2026-07-15', 2);
  assert.equal(w[0], '2026-05-15');
  assert.equal(w[w.length - 1], '2026-09-15');
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

const HP2 = { ...HP, doctorName: 'Pushpinder Singh' };

test('clinicaAppointmentToBody: numeric ids, patient_role_id, service + order defaults', () => {
  const body = clinicaAppointmentToBody(
    { appnt_date: '2026-07-01', appnt_time: '15:34:00', patient_name: 'anaya', patient_phone_number: '7868423475' },
    HP2,
    5127127980,
  );
  // ids are NUMBERS
  assert.equal(body.doctor_id, 5126673344);
  assert.equal(body.patient_role_id, 5127127980);
  assert.equal(body.org_branch_id, 217306);
  assert.equal(body.billing_person_role_id, 5126699479);
  assert.equal(body.appnt_doctor_role_id, 5126699479);
  // service + billing defaults
  assert.equal(body.appnt_service_id, 5031193187);
  assert.equal(body.appnt_service_name, 'consultation');
  assert.equal(body.appnt_duration, 10);
  assert.equal(body.order_item_price, 560);
  assert.equal(body.order_unit_item_price, 500);
  // strings + flags
  assert.equal(body.appnt_date, '2026-07-01');
  assert.equal(body.appnt_time, '15:34:00');
  assert.equal(body.patient_name, 'anaya');
  assert.equal(body.appnt_doctor_name, 'Pushpinder Singh');
  assert.equal(body.skip_appnt_bill, true);
  assert.equal(body.is_partner_appointment, false);
});

test('clinicaAppointmentToBody: derives doctor name from branchName when doctorName absent', () => {
  const body = clinicaAppointmentToBody({ appnt_date: '2026-07-01' }, { ...HP, branchName: 'Dr Pushpinder Singh' }, 1);
  assert.equal(body.appnt_doctor_name, 'Pushpinder Singh');
});
