// Best-effort HealthPlix data dump. Never throws into the request path — the dump is a
// safety net, so a failure (incl. the not-yet-ported stub) is logged, not surfaced.

import { dumpHealthplixData } from './healthplix/client.js';

export async function bestEffortDump(healthplix, ctx = '') {
  try {
    await dumpHealthplixData(healthplix);
    console.log(`[intake] data dump ok ${ctx}`);
  } catch (e) {
    console.warn(`[intake] data dump skipped ${ctx}: ${e.message}`);
  }
}
