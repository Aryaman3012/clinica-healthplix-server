// HealthPlix API client — replays the stored Bearer JWT (pushed by the courier extension).
// Endpoints (verified live 2026-07-01):
//   GET  /v2/appointments?appnt_date&doctor_role_id&doctor_id&org_branch_id → { appointments }
//   POST /patient/search  { branch_id, doctor_id, doctor_role_id, term, limit } → { persons }
//   POST /v1/patient/add  { name, phone, gender, …, doctor_role_id, doctor_id, org_branch_id, token }
// Implemented: dumpHealthplixData (patients + appointments), pushPatientToHealthplix
// (find-or-create). STILL BLOCKED: pushAppointmentToHealthplix (no create-appointment endpoint yet).

import { config } from '../config.js';
import { getCredentials, getIntakeDump, storeIntakeDump } from '../db.js';

const BASE = config.healthplixApiBase;
const WEB_APP_URL = config.healthplixWebApp;

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
export async function apiFetch(clinicId, path, options = {}) {
  const auth = await getAuth(clinicId);
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(auth), ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HealthPlix API ${res.status}: ${path}`);
  return res.json();
}

// fetchJson() calls HealthPlix with an explicit identity (pending creds have no clinicId).
export async function fetchJson(healthplix, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(healthplix), ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HealthPlix API ${res.status}: ${path}`);
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
    phone: String(g(patient, 'phone', 'mobile', 'phone_number', 'contact') ?? ''),
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

// Find-or-create a HealthPlix patient for a Clinica patient. Returns { personId, created }.
export async function pushPatientToHealthplix(clinicId, patient) {
  const doc = await getCredentials(clinicId);
  const hp = doc?.healthplix;
  if (!hp?.token || doc?.revoked) throw new Error(`No HealthPlix credentials for clinic ${clinicId}`);

  const body = clinicaPatientToAddBody(patient, hp);

  // Dedup by phone via /patient/search before creating.
  if (body.phone) {
    const s = await fetchJson(hp, '/patient/search', {
      method: 'POST',
      body: JSON.stringify({
        branch_id: body.org_branch_id, doctor_id: body.doctor_id, doctor_role_id: body.doctor_role_id,
        term: body.phone, limit: 30,
      }),
    });
    const existing = (s?.persons ?? []).find((p) => String(p.org_person_phone) === String(body.phone));
    if (existing) {
      console.log(`[push] patient exists (person_id ${existing.person_id}) — skipping create`);
      return { personId: existing.person_id, created: false };
    }
  }

  const res = await fetchJson(hp, '/v1/patient/add', { method: 'POST', body: JSON.stringify(body) });
  console.log('[push] patient created on HealthPlix');
  return { personId: res?.person_id ?? res?.data?.person_id ?? null, created: true, res };
}

// --- Appointment write (BLOCKED) -------------------------------------------------------

export async function pushAppointmentToHealthplix(clinicId, appointment) {
  // The endpoints provided (GET /v2/appointments, POST /appointments/get) are READS.
  // A create/save-appointment endpoint is still needed — capture the request HealthPlix
  // fires when you BOOK/SAVE an appointment in md.healthplix.com and wire it here
  // (find-or-create patient via pushPatientToHealthplix, then POST the appointment).
  throw new Error('pushAppointmentToHealthplix not implemented — need the HealthPlix create-appointment endpoint');
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
