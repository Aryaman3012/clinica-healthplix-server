// HealthPlix API client — replays the stored Bearer JWT (pushed by the courier extension).
// Endpoints (verified live 2026-07-01):
//   GET  /v2/appointments?appnt_date&doctor_role_id&doctor_id&org_branch_id → { appointments }
//   POST /patient/search  { branch_id, doctor_id, doctor_role_id, term, limit } → { persons }
//   POST /v1/patient/add  { name, phone, gender, …, doctor_role_id, doctor_id, org_branch_id, token }
//   POST /v1/appointment  { doctor_id, patient_role_id, org_branch_id, appnt_date/time, service…, order… }
// Implemented: dumpHealthplixData, pushPatientToHealthplix (find-or-create),
// pushAppointmentToHealthplix (find-or-create patient → create appointment).

import { config } from '../config.js';
import { getCredentials, getIntakeDump, storeIntakeDump } from '../db.js';

const BASE = config.healthplixApiBase;
const WEB_APP_URL = config.healthplixWebApp;

// Defaults for the consultation service + its billing line, taken from a real booking.
// Wire a services endpoint later if pricing/service must vary per appointment.
const DEFAULT_SERVICE = { id: 5031193187, name: 'consultation' };
const DEFAULT_APPT_DURATION = 10;
const DEFAULT_ORDER = { item_price: 560, service_tax: 60, unit_price: 500 };

// Load + validate the stored HealthPlix auth for a clinic.
async function getAuth(clinicId) {
  const doc = await getCredentials(clinicId);
  const auth = doc?.healthplix;
  if (!auth?.token || doc?.revoked) {
    throw new Error(`No HealthPlix credentials for clinic ${clinicId} — extension must push them`);
  }
  if (auth.exp && Date.now() / 1000 > auth.exp) {
    throw new Error(`HealthPlix session expired for clinic ${clinicId} — doctor must reopen md.healthplix.com`);
  }
  return auth;
}

function headers(auth, extra = {}) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${auth.token}`,
    origin: WEB_APP_URL,
    referer: `${WEB_APP_URL}/`,
    ...extra,
  };
}

// Authenticated fetch against the HealthPlix API for a given clinic.
async function throwHttp(res, path) {
  const body = await res.text().catch(() => '');
  throw new Error(`HealthPlix API ${res.status} ${path}: ${body.slice(0, 300)}`);
}

export async function apiFetch(clinicId, path, options = {}) {
  const auth = await getAuth(clinicId);
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(auth), ...(options.headers ?? {}) },
  });
  if (!res.ok) await throwHttp(res, path);
  return res.json();
}

// fetchJson() calls HealthPlix with an explicit identity (pending creds have no clinicId).
export async function fetchJson(healthplix, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(healthplix), ...(options.headers ?? {}) },
  });
  if (!res.ok) await throwHttp(res, path);
  return res.json();
}

// --- Date helpers (IST, fixed +05:30) --------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateStr(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10); // YYYY-MM-DD in IST
}

// Inclusive window [today-back … today+fwd] as IST date strings. `now` injectable for tests.
export function recentDates(back, fwd, now = Date.now()) {
  const out = [];
  for (let i = -back; i <= fwd; i++) out.push(istDateStr(now + i * 86400000));
  return out;
}

// --- Patient reads/writes --------------------------------------------------------------

const g = (obj, ...keys) => {
  for (const k of keys) if (obj?.[k] != null && obj[k] !== '') return obj[k];
  return undefined;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function mapGender(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (s.startsWith('M')) return 'M';
  if (s.startsWith('F')) return 'F';
  if (s.startsWith('O')) return 'O';
  return '';
}

// Map a Clinica patient (from the SSE patient.upserted payload) → HealthPlix /v1/patient/add
// body. ASSUMPTION: Clinica field names (name/phone/gender/…). Verify against a real
// patient.upserted payload and adjust the g(...) key lists as needed.
export function clinicaPatientToAddBody(patient, hp) {
  return {
    name: g(patient, 'name', 'full_name', 'patient_name') ?? '',
    phone: String(g(patient, 'phone', 'mobile', 'phone_number', 'contact', 'patient_phone_number', 'patient_phone') ?? ''),
    gender: mapGender(g(patient, 'gender', 'sex')),
    honorific: '',
    patient_preferred_language: 'en',
    age: g(patient, 'dob', 'date_of_birth', 'age') ?? '',
    age_selector: 'years',
    blood_group: g(patient, 'blood_group') ?? '',
    email: g(patient, 'email') ?? '',
    address: g(patient, 'address') ?? '',
    city: g(patient, 'city') ?? '',
    existing_bid_str: '',
    pincode: String(g(patient, 'pincode', 'pin', 'zip') ?? ''),
    ref_doc_id: '', ref_doc_name: '', ref_doc_spec: '', through_channel: '', care_of: '',
    phone_secondary: '', occupation: '', tag: '', marital_status: '', married_since: '',
    spouse_name: '', spouse_blood_group: '', aadhar_number: '', custom_fields: [],
    abha_address: '', abha_number: '',
    doctor_role_id: String(hp.doctorRoleId),
    doctor_id: String(hp.doctorId),
    org_branch_id: String(hp.branchId),
    source: 'emr',
    ip: '',
    token: hp.token,
  };
}

// Search a patient by phone, returning the HealthPlix person or null.
async function findPatientByPhone(hp, phone, ids) {
  if (!phone) return null;
  const s = await fetchJson(hp, '/patient/search', {
    method: 'POST',
    body: JSON.stringify({ branch_id: ids.org_branch_id, doctor_id: ids.doctor_id, doctor_role_id: ids.doctor_role_id, term: phone, limit: 30 }),
  });
  return (s?.persons ?? []).find((p) => String(p.org_person_phone) === String(phone)) ?? null;
}

// Find-or-create a HealthPlix patient. Returns { personId, personRoleId, created }.
// personRoleId (person_role_id) is what an appointment needs as patient_role_id.
async function findOrCreatePatient(hp, patientInput) {
  const body = clinicaPatientToAddBody(patientInput, hp);
  const ids = { org_branch_id: body.org_branch_id, doctor_id: body.doctor_id, doctor_role_id: body.doctor_role_id };

  const existing = await findPatientByPhone(hp, body.phone, ids);
  if (existing) {
    return { personId: existing.person_id, personRoleId: existing.person_role_id, created: false };
  }

  const res = await fetchJson(hp, '/v1/patient/add', { method: 'POST', body: JSON.stringify(body) });
  let personId = res?.person_id ?? res?.data?.person_id ?? null;
  let personRoleId = res?.person_role_id ?? res?.data?.person_role_id ?? null;

  // If the add response didn't surface ids, re-search to resolve the freshly created patient.
  if (!personRoleId && body.phone) {
    const fresh = await findPatientByPhone(hp, body.phone, ids);
    if (fresh) { personId = fresh.person_id; personRoleId = fresh.person_role_id; }
  }
  return { personId, personRoleId, created: true };
}

// A Clinica appointment may nest the patient or carry patient_* fields inline.
function extractPatient(appointment) {
  return appointment && typeof appointment.patient === 'object' && appointment.patient
    ? appointment.patient
    : appointment;
}

// Clinica appointment (SSE appointment.upserted payload) → HealthPlix POST /v1/appointment body.
// ASSUMPTION: Clinica field names (appnt_date/time/duration/service…). Verify against a real
// appointment.upserted payload and adjust the g(...) key lists. Ids are numbers here.
export function clinicaAppointmentToBody(appointment, hp, patientRoleId) {
  const date = g(appointment, 'appnt_date', 'date', 'appointment_date') ?? istDateStr(Date.now());
  const doctorName =
    hp.doctorName || String(hp.branchName ?? '').replace(/^dr\.?\s*/i, '') || '';
  return {
    doctor_id: num(hp.doctorId),
    patient_role_id: num(patientRoleId),
    org_branch_id: num(hp.branchId),
    billing_person_role_id: num(hp.doctorRoleId),
    appnt_date: String(date),
    patient_name: g(appointment, 'patient_name', 'name') ?? '',
    patient_phone_number: String(g(appointment, 'patient_phone_number', 'patient_phone', 'phone', 'mobile') ?? ''),
    appnt_doctor_name: doctorName,
    appnt_doctor_role_id: num(hp.doctorRoleId),
    appnt_duration: num(g(appointment, 'appnt_duration', 'duration') ?? DEFAULT_APPT_DURATION),
    appnt_service_id: num(g(appointment, 'appnt_service_id', 'service_id') ?? DEFAULT_SERVICE.id),
    appnt_service_name: g(appointment, 'appnt_service_name', 'service_name') ?? DEFAULT_SERVICE.name,
    appnt_status: num(g(appointment, 'appnt_status', 'status') ?? 0),
    appnt_time: String(g(appointment, 'appnt_time', 'time', 'appointment_time') ?? '00:00:00'),
    skip_appnt_bill: true,
    order_date: String(g(appointment, 'order_date', 'appnt_date', 'date') ?? date),
    item_quantity: 1,
    order_item_discount: num(g(appointment, 'order_item_discount') ?? 0),
    order_item_price: num(g(appointment, 'order_item_price') ?? DEFAULT_ORDER.item_price),
    order_item_service_tax: num(g(appointment, 'order_item_service_tax') ?? DEFAULT_ORDER.service_tax),
    order_unit_item_price: num(g(appointment, 'order_unit_item_price') ?? DEFAULT_ORDER.unit_price),
    is_partner_appointment: false,
  };
}

// Find-or-create a HealthPlix patient for a Clinica patient. Returns { personId, personRoleId, created }.
export async function pushPatientToHealthplix(clinicId, patient) {
  const hp = await getAuth(clinicId);
  const r = await findOrCreatePatient(hp, patient);
  console.log(r.created ? `[push] patient created (person_role_id ${r.personRoleId})` : `[push] patient exists (person_role_id ${r.personRoleId})`);
  return r;
}

// Create an appointment on HealthPlix: ensure the patient exists, then POST /v1/appointment.
export async function pushAppointmentToHealthplix(clinicId, appointment) {
  const hp = await getAuth(clinicId);
  const { personRoleId } = await findOrCreatePatient(hp, extractPatient(appointment));
  if (!personRoleId) throw new Error('could not resolve patient_role_id for appointment');

  const body = clinicaAppointmentToBody(appointment, hp, personRoleId);
  const res = await fetchJson(hp, '/v1/appointment', { method: 'POST', body: JSON.stringify(body) });
  console.log(`[push] appointment created on HealthPlix (patient_role_id ${personRoleId})`);
  return { res };
}

// --- Intake data dump ------------------------------------------------------------------
// Replaces the old dumpHealthplixToIntake / archiveRecentAppointmentsToIntake. Pulls all
// patients + appointments (over a date window) using the given creds and stores them to
// CouchDB, independent of Clinica linking. Throttled so repeated pushes don't re-dump.

export async function dumpHealthplixData(healthplix) {
  const doctorId = String(healthplix.doctorId ?? '');
  const doctorRoleId = String(healthplix.doctorRoleId ?? '');
  const branchId = String(healthplix.branchId ?? '');
  if (!doctorId || !doctorRoleId || !branchId) throw new Error('dump: missing doctor/branch id in creds');

  const recent = await getIntakeDump(branchId);
  if (recent?.dumpedAt && Date.now() - Date.parse(recent.dumpedAt) < config.dumpMinIntervalMs) {
    console.log(`[intake] dump skipped for branch ${branchId} (dumped recently)`);
    return { skipped: true };
  }

  // Patients (term '' lists them).
  const psearch = await fetchJson(healthplix, '/patient/search', {
    method: 'POST',
    body: JSON.stringify({ branch_id: branchId, doctor_id: doctorId, doctor_role_id: doctorRoleId, term: '', limit: 1000 }),
  });
  const patients = psearch?.persons ?? [];

  // Appointments over the configured date window.
  const dates = recentDates(config.dumpDaysBack, config.dumpDaysFwd);
  const appointments = [];
  for (const d of dates) {
    const r = await fetchJson(
      healthplix,
      `/v2/appointments?appnt_date=${d}&doctor_role_id=${doctorRoleId}&doctor_id=${doctorId}&org_branch_id=${branchId}`,
    );
    for (const a of r?.appointments ?? []) appointments.push(a);
  }

  await storeIntakeDump(branchId, { patients, appointments, dates, dumpedAt: new Date().toISOString() });
  console.log(`[intake] dumped ${patients.length} patients + ${appointments.length} appointments for branch ${branchId}`);
  return { patients: patients.length, appointments: appointments.length };
}
