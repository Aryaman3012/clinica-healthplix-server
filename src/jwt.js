// JWT helpers. We do NOT verify Clinica JWT signatures here — clinica-portal validates
// them (see clinica/register.js). decodeJwt is only used to derive a clinic identifier.

export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Best-effort clinic identifier from the Clinica JWT. Adjust the claim names to match
// clinica-portal's token once known.
export function clinicIdFromJwt(token) {
  const claims = decodeJwt(token) ?? {};
  return claims.clinic_id ?? claims.clinicId ?? claims.org_id ?? claims.sub ?? null;
}
