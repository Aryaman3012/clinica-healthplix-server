// Authless (lightly-protected) intake fallback.
//
//   POST /v1/intake/credentials   X-Intake-Key: <shared secret>
//
// Accepts HealthPlix creds WITHOUT a Clinica JWT, so data is never lost when Clinica isn't
// linked (or its JWT expired). Stores them as a 'pending' doc and kicks off a best-effort
// data dump. When a real authed registration later arrives for the same account, the
// pending doc is cleaned up (see routes/credentials.js).
//
// Protection: a shared secret header (must match the courier's baked-in INTAKE_KEY) plus an
// optional Origin allowlist. Not bulletproof — deliberately "lightly protected".

import { Router } from 'express';
import { config } from '../config.js';
import { upsertPendingCredentials } from '../db.js';
import { bestEffortDump } from '../dump.js';

export const intakeRouter = Router();

function gate(req, res) {
  if (!config.intakeKey) {
    res.status(503).json({ ok: false, error: 'intake disabled (no INTAKE_KEY configured)' });
    return false;
  }
  if (req.headers['x-intake-key'] !== config.intakeKey) {
    res.status(401).json({ ok: false, error: 'bad intake key' });
    return false;
  }
  if (config.intakeAllowedOrigin && req.headers['origin'] !== config.intakeAllowedOrigin) {
    res.status(403).json({ ok: false, error: 'origin not allowed' });
    return false;
  }
  return true;
}

intakeRouter.post('/intake/credentials', async (req, res) => {
  if (!gate(req, res)) return;

  const healthplix = req.body?.healthplix;
  if (!healthplix?.token) return res.status(400).json({ ok: false, error: 'missing healthplix.token' });

  const accountId = healthplix.branchId ?? healthplix.doctorRoleId;
  if (!accountId) return res.status(400).json({ ok: false, error: 'missing account id (branchId/doctorRoleId)' });

  try {
    await upsertPendingCredentials(accountId, healthplix);
    console.log(`[intake] stored pending HealthPlix creds for account ${accountId} (unlinked)`);
    bestEffortDump(healthplix, `(pending account ${accountId})`); // fire-and-forget
    return res.json({ ok: true, pending: true });
  } catch (e) {
    console.error('[intake] store error:', e.message);
    return res.status(502).json({ ok: false, error: 'store failed' });
  }
});
