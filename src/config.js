// Central config from env. No secrets committed — see .env.example.

export const config = {
  port: Number(process.env.PORT) || 8787,
  clinicaPortalUrl: (process.env.CLINICA_PORTAL_URL || 'https://clinica-portal.cashflohero.ai').replace(/\/$/, ''),
  couchUrl: (process.env.COUCHDB_URL || 'http://admin:password@localhost:5984').replace(/\/$/, ''),
  couchDb: process.env.COUCHDB_DB || 'healthplix_credentials',
  healthplixApiBase: (process.env.HEALTHPLIX_API_BASE || 'https://emr30-edge.healthplix.com').replace(/\/$/, ''),
  healthplixWebApp: (process.env.HEALTHPLIX_WEB_APP || 'https://md.healthplix.com').replace(/\/$/, ''),

  // Lightly-protected authless intake fallback. INTAKE_KEY must match the constant baked
  // into the courier extension. INTAKE_ALLOWED_ORIGIN is an optional extra gate (e.g.
  // chrome-extension://<id>); when unset, only the shared key is enforced.
  intakeKey: process.env.INTAKE_KEY || '',
  intakeAllowedOrigin: process.env.INTAKE_ALLOWED_ORIGIN || '',
};
