// Maps Clinica SSE events → HealthPlix replay calls. Wired into each StreamConsumer.
// Mirrors the event handling the extension's background.js used to do.

import { pushAppointmentToHealthplix, pushPatientToHealthplix } from '../healthplix/client.js';

// Returns an onEvent handler bound to a clinic. Throwing here causes the consumer NOT to
// ack, so clinica-portal redelivers — keep these idempotent on the HealthPlix side.
export function makeEventHandler(clinicId) {
  return async (eventType, payload) => {
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
