// The contract the courier extension talks to.
//   POST   /v1/credentials  (Bearer Clinica JWT)  — store HealthPlix creds, start sync
//   DELETE /v1/credentials  (Bearer Clinica JWT)  — revoke creds, pause sync
//   GET    /v1/credentials/status (Bearer Clinica JWT) — liveness for the popup

import { Router } from 'express';
import { registerWithClinica } from '../clinica/register.js';
import { clinicIdFromJwt } from '../jwt.js';
import { upsertCredentials, revokeCredentials, getCredentials, deletePending } from '../db.js';
import { ensureConsumer, stopConsumer } from '../manager.js';
import { bestEffortDump } from '../dump.js';

export const credentialsRouter = Router();

function bearer(req) {
  const h = req.headers['authorization'] ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

credentialsRouter.post('/credentials', async (req, res) => {
  const clinicaJwt = bearer(req);
  if (!clinicaJwt) return res.status(401).json({ ok: false, error: 'missing bearer token' });

  const healthplix = req.body?.healthplix;
  if (!healthplix?.token) return res.status(400).json({ ok: false, error: 'missing healthplix.token' });

  const accountId = healthplix.branchId ?? healthplix.doctorRoleId;
  const accountData = {
    doctorId: healthplix.doctorId,
    doctorRoleId: healthplix.doctorRoleId,
    branchId: healthplix.branchId,
    branchName: healthplix.branchName,
    name: healthplix.doctorName,
  };

  try {
    // Validates the Clinica JWT (401 if bad) AND returns the SSE stream token.
    const reg = await registerWithClinica(clinicaJwt, accountId, accountData);
    const clinicId = clinicIdFromJwt(clinicaJwt) ?? accountId;

    await upsertCredentials(clinicId, {
      accountId,
      healthplix,
      clinicaStreamToken: reg.token,
    });
    ensureConsumer(clinicId, reg.token);

    // This account is now linked — clean up any pending (unlinked) fallback doc + dump data.
    if (accountId) await deletePending(accountId).catch(() => {});
    bestEffortDump(healthplix, `(clinic ${clinicId})`); // fire-and-forget

    // Token-free receipt log (never print the JWT). Confirms the push arrived + was stored.
    console.log(
      `[credentials] received HealthPlix token for clinic ${clinicId} (account ${accountId}) ` +
        `— stored, consumer ensured (alreadyLinked=${reg.alreadyLinked ?? false})`,
    );
    return res.json({ ok: true, alreadyLinked: reg.alreadyLinked ?? false });
  } catch (e) {
    if (e.status === 401) return res.status(401).json({ ok: false, error: 'invalid clinica jwt' });
    if (e.status === 409) return res.status(409).json({ ok: false, error: 'clinic already linked', existing: e.body?.existing });
    console.error('[credentials] push error:', e.message);
    return res.status(502).json({ ok: false, error: 'upstream error' });
  }
});

credentialsRouter.delete('/credentials', async (req, res) => {
  const clinicaJwt = bearer(req);
  if (!clinicaJwt) return res.status(401).json({ ok: false, error: 'missing bearer token' });

  const clinicId = clinicIdFromJwt(clinicaJwt);
  if (!clinicId) return res.status(400).json({ ok: false, error: 'cannot derive clinic from token' });

  await revokeCredentials(clinicId);
  stopConsumer(clinicId);
  console.log(`[credentials] revoked HealthPlix creds for clinic ${clinicId} — consumer stopped`);
  return res.json({ ok: true });
});

credentialsRouter.get('/credentials/status', async (req, res) => {
  const clinicaJwt = bearer(req);
  if (!clinicaJwt) return res.status(401).json({ ok: false, error: 'missing bearer token' });

  const clinicId = clinicIdFromJwt(clinicaJwt);
  const doc = clinicId ? await getCredentials(clinicId) : null;
  const auth = doc?.healthplix;
  const expired = auth?.exp && Date.now() / 1000 > auth.exp;

  return res.json({
    healthplixLinked: Boolean(auth?.token && !doc?.revoked && !expired),
    lastReplayOk: null, // wire to real replay outcome tracking when available
    lastSeen: doc?.updatedAt ?? null,
  });
});
