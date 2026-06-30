import express from 'express';
import { config } from './config.js';
import { ensureDb } from './db.js';
import { credentialsRouter } from './routes/credentials.js';
import { resumeConsumers } from './manager.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/v1', credentialsRouter);

async function start() {
  try {
    await ensureDb();
    await resumeConsumers();
  } catch (e) {
    // Don't crash on a transient CouchDB/clinica-portal hiccup at boot — the HTTP API can
    // still accept pushes, and consumers resume on the next push.
    console.error('[boot] warning:', e.message);
  }

  app.listen(config.port, () => {
    console.log(`[server] clinica-healthplix-server listening on http://localhost:${config.port}`);
    console.log(`[server] clinica-portal: ${config.clinicaPortalUrl}`);
    console.log(`[server] couchdb db:     ${config.couchDb}`);
  });
}

start();
