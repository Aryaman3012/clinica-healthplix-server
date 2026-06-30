# clinica-healthplix-server

Replay server for the [Clinica × HealthPlix courier extension](../extension). The extension
is a thin courier: it harvests the HealthPlix Bearer JWT from the doctor's logged-in tab and
POSTs it here. This server stores those credentials and does the actual work — consuming
Clinica events and replaying them against the HealthPlix API.

```
clinica-portal ──SSE /api/practo/stream──► THIS SERVER ──replay Bearer JWT──► HealthPlix API
                                                ▲
                                                │ POST /v1/credentials (Bearer Clinica JWT)
                                            courier extension
```

## Design decisions

- **Stack:** Node + Express (ESM).
- **Event ingest:** SSE consumer against clinica-portal's existing `/api/practo/stream/:token`
  (one consumer per clinic). No clinica-portal changes required.
- **JWT validation:** delegated to clinica-portal — `POST /api/practo/register` validates the
  Clinica JWT (401 if bad) and returns the stream token in one call.
- **Storage:** CouchDB (already used for HealthPlix), one doc per clinic.

## Endpoints (the courier contract)

| Method | Path | Auth | Action |
|---|---|---|---|
| `POST` | `/v1/credentials` | Bearer Clinica JWT | Validate JWT via clinica-portal, store HealthPlix creds, start SSE consumer |
| `DELETE` | `/v1/credentials` | Bearer Clinica JWT | Revoke creds, stop consumer |
| `GET` | `/v1/credentials/status` | Bearer Clinica JWT | Liveness for the extension popup |
| `GET` | `/health` | none | Health check |

## Setup

```bash
npm install
cp .env.example .env   # fill in CLINICA_PORTAL_URL, COUCHDB_URL, COUCHDB_DB
npm start              # or: npm run dev  (node --watch)
npm test               # unit tests (node --test)
```

Point the extension's popup **Server URL** field at this server (e.g. `http://localhost:8787`)
and add its origin to the extension's `host_permissions`.

## ⚠️ Unfinished: replay bodies

The HealthPlix booking/patient call bodies (`pushAppointmentToHealthplix`,
`pushPatientToHealthplix` in [src/healthplix/client.js](src/healthplix/client.js)) are
**stubs that throw**. Their original implementations lived in the extension's now-deleted
`api/healthplix.js` + `api/sync.js`. Port that logic in to finish the server. The auth
foundation (`apiFetch`, header building, stored-JWT lookup + expiry) is already done — the
stubs just need the request shapes (find-or-create patient, create appointment, services).

Also confirm the Clinica JWT claim name for the clinic id in
[src/jwt.js](src/jwt.js) (`clinicIdFromJwt`) against a real token.
