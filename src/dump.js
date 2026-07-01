// Best-effort writes. Never throw into the request path — these are safety nets, so a
// failure (incl. a not-yet-ported stub) is logged, not surfaced.
//
// Two concerns with DIFFERENT gating:
//   - bestEffortDump: the raw fallback dump → intake store. Runs with or WITHOUT a Clinica
//     token (called from both the intake and credentials routes).
//   - bestEffortDumpAndSync: fallback dump PLUS the mapped-doc push into Clinica's documents.
//     AUTH-ONLY — called only from the authenticated credentials route.

import { dumpHealthplixData } from './healthplix/client.js';
import { syncDumpToClinica } from './clinica/sync.js';

export async function bestEffortDump(healthplix, ctx = '') {
  try {
    await dumpHealthplixData(healthplix);
    console.log(`[intake] data dump ok ${ctx}`);
  } catch (e) {
    console.warn(`[intake] data dump skipped ${ctx}: ${e.message}`);
  }
}

// Fallback dump first (always), then the authenticated-only mapped push into Clinica.
export async function bestEffortDumpAndSync(healthplix, clinicId, branchId, ctx = '') {
  await bestEffortDump(healthplix, ctx);
  try {
    await syncDumpToClinica(clinicId, branchId);
    console.log(`[clinica-sync] mapped docs pushed into Clinica ${ctx}`);
  } catch (e) {
    console.warn(`[clinica-sync] skipped ${ctx}: ${e.message}`);
  }
}
