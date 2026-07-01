// Mapped-doc push into Clinica's documents. AUTH-ONLY: only invoked from the authenticated
// credentials route (a validated Clinica JWT → clinicId). The raw fallback dump
// (storeIntakeDump) has already run token-independently, so no data is lost either way; this
// step maps that data into Clinica's own document schema and writes it into Clinica.

import { getIntakeDump } from '../db.js';

// Reads the fallback intake dump for the branch, maps HealthPlix patients/appointments into
// Clinica documents, and pushes them into Clinica for the authenticated clinic.
export async function syncDumpToClinica(clinicId, branchId) {
  const dump = await getIntakeDump(branchId);
  if (!dump) {
    console.log(`[clinica-sync] no intake dump yet for branch ${branchId} — nothing to map`);
    return { skipped: true };
  }
  const patients = dump.patients ?? [];
  const appointments = dump.appointments ?? [];

  // TODO: map each HealthPlix patient/appointment → the Clinica document schema and write it
  // into Clinica for clinic ${clinicId}. Needs:
  //   1. the Clinica patient + appointment document shapes, and
  //   2. the write target — clinica-portal API endpoint, or the Clinica CouchDB db name.
  throw new Error(
    `syncDumpToClinica not implemented — need the Clinica document schema + write target ` +
      `(clinic ${clinicId}: ${patients.length} patients / ${appointments.length} appts ready to map)`,
  );
}
