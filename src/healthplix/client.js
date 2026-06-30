// HealthPlix API client — replays the stored Bearer JWT (pushed by the courier extension).
// The auth foundation (apiFetch/headers) is ported from the old extension's api/healthplix.js.
// The booking/patient call BODIES (pushAppointment/pushPatient) lived in the extension's
// api/healthplix.js + api/sync.js, which were deleted — fill them in below (see TODOs).

import { config } from '../config.js';
import { getCredentials } from '../db.js';

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

// --- Replay operations (skeletons) -----------------------------------------------------
// These mirror the deleted extension functions pushAppointmentToHealthplix /
// pushPatientToHealthplix. Port the real request bodies + endpoints here.

export async function pushAppointmentToHealthplix(clinicId, appointment) {
  // TODO: port from the old extension api/healthplix.js + api/sync.js.
  // Shape was: find-or-create patient, then POST the appointment with the default service.
  // Example call once implemented:
  //   return apiFetch(clinicId, '/appointments', { method: 'POST', body: JSON.stringify(...) });
  throw new Error('pushAppointmentToHealthplix not implemented — port the deleted replay logic');
}

export async function pushPatientToHealthplix(clinicId, patient) {
  // TODO: port from the old extension api/healthplix.js.
  throw new Error('pushPatientToHealthplix not implemented — port the deleted replay logic');
}
