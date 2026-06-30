// Express app factory — no side effects (no listen, no DB/consumer boot), so tests can
// mount it on an ephemeral port. index.js wires in boot + listen.

import express from 'express';
import { credentialsRouter } from './routes/credentials.js';
import { intakeRouter } from './routes/intake.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/v1', credentialsRouter);
  app.use('/v1', intakeRouter);
  return app;
}
