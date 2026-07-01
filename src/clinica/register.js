// Talks to clinica-portal. Registration doubles as Clinica-JWT validation: clinica-portal
// returns 401 for a bad token, and a stream token for a good one.
//
// NOTE: clinica-portal's integration channel is still Practo-named (/api/practo/*). Kept
// as-is until that backend is renamed; the data semantics are HealthPlix.

import { config } from '../config.js';

// Validate the Clinica JWT and obtain an SSE stream token for this clinic/account.
// Throws an error with .status=401 for an invalid token.
export async function registerWithClinica(clinicaJwt, accountId, accountData) {
  const res = await fetch(`${config.clinicaPortalUrl}/api/practo/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clinicaJwt}` },
    body: JSON.stringify({ practoAccountId: accountId, practoAccountData: accountData }),
  });

  if (!res.ok) {
    const err = new Error(`clinica register failed: ${res.status}`);
    err.status = res.status;
    err.body = await res.json().catch(() => ({}));
    throw err;
  }

  const { data } = await res.json();
  // Diagnostic: surface exactly what clinica-portal returned so we can tell whether a usable
  // stream token came back (esp. in the alreadyLinked=true case). Token value is redacted.
  const tok = data?.token;
  console.log(
    `[register] response keys=[${Object.keys(data ?? {}).join(',')}] ` +
      `token=${tok ? `present(${String(tok).length}ch …${String(tok).slice(-4)})` : 'MISSING'} ` +
      `alreadyLinked=${data?.alreadyLinked}`,
  );
  return data; // { token, alreadyLinked }
}

export async function ackEvent(streamToken, eventId) {
  await fetch(`${config.clinicaPortalUrl}/api/practo/ack/${streamToken}/${eventId}`, { method: 'POST' });
}
