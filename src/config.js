// Central config from env. No secrets committed — see .env.example.

export const config = {
  port: Number(process.env.PORT) || 8787,
  clinicaPortalUrl: (process.env.CLINICA_PORTAL_URL || 'https://clinica-portal.cashflohero.ai').replace(/\/$/, ''),
  couchUrl: (process.env.COUCHDB_URL || 'http://admin:password@localhost:5984').replace(/\/$/, ''),
  couchDb: process.env.COUCHDB_DB || 'healthplix_credentials',
  healthplixApiBase: (process.env.HEALTHPLIX_API_BASE || 'https://emr30-edge.healthplix.com').replace(/\/$/, ''),
  healthplixWebApp: (process.env.HEALTHPLIX_WEB_APP || 'https://md.healthplix.com').replace(/\/$/, ''),
};
