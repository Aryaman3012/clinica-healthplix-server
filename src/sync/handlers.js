// Maps Clinica SSE events → HealthPlix replay calls. Wired into each StreamConsumer.
// Mirrors the event handling the extension's background.js used to do.

import { pushAppointmentToHealthplix, pushPatientToHealthplix } from '../healthplix/client.js';

// Field NAMES + one level of nesting, no values — reveals the Clinica payload shape in logs
// so we can align the mappers without dumping PHI.
function shapeOf(v) {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      out[k] = Array.isArray(x)
        ? `array[${x.length}]`
        : x && typeof x === 'object'
          ? `{${Object.keys(x).join(',')}}`
          : typeof x;
    }
    return out;
  }
  return typeof v;
}

// Returns an onEvent handler bound to a clinic. Throwing here causes the consumer NOT to
// ack, so clinica-portal redelivers — keep these idempotent on the HealthPlix side.
export function makeEventHandler(clinicId) {
  return async (eventType, payload) => {
    console.log(`[sync:${clinicId}] ${eventType} payload shape:`, JSON.stringify(shapeOf(payload?.data)));
    switch (eventType) {
      case 'appointment.upserted':
        await pushAppointmentToHealthplix(clinicId, payload.data);
        break;
      case 'patient.upserted':
        await pushPatientToHealthplix(clinicId, payload.data);
        break;
      default:
        console.log(`[sync:${clinicId}] ignoring event: ${eventType}`);
    }
  };
}
