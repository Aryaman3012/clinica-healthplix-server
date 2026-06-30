// Owns the live SSE consumers — one per clinic. Idempotent: ensureConsumer can be called on
// every credential push; it only (re)starts a consumer when the stream token changes.

import { StreamConsumer } from './clinica/stream.js';
import { makeEventHandler } from './sync/handlers.js';
import { listActiveCredentials } from './db.js';

const consumers = new Map(); // clinicId -> { token, consumer }

export function ensureConsumer(clinicId, streamToken) {
  const existing = consumers.get(clinicId);
  if (existing && existing.token === streamToken) return; // already running with this token
  existing?.consumer.stop();

  const consumer = new StreamConsumer(clinicId, streamToken, makeEventHandler(clinicId));
  consumer.start();
  consumers.set(clinicId, { token: streamToken, consumer });
  console.log(`[manager] consumer started for clinic ${clinicId}`);
}

export function stopConsumer(clinicId) {
  consumers.get(clinicId)?.consumer.stop();
  consumers.delete(clinicId);
  console.log(`[manager] consumer stopped for clinic ${clinicId}`);
}

// On boot, resume consumers for every clinic that has live credentials + a stream token.
export async function resumeConsumers() {
  const docs = await listActiveCredentials();
  for (const doc of docs) {
    if (doc.clinicaStreamToken) ensureConsumer(doc.clinicId, doc.clinicaStreamToken);
  }
  console.log(`[manager] resumed ${docs.length} consumer(s)`);
}
