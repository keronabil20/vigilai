# Control plane & ingest API

Base URLs (local):

- Control plane: `http://localhost:3001`
- Ingest: `http://localhost:3002`

## Auth

### `POST /auth/register`
Body: `{ email, password, name?, orgName? }` → `{ token, user, org }`

### `POST /auth/login`
Body: `{ email, password }` → `{ token, user, orgs }`

### `GET /auth/me`
Bearer JWT → current user + orgs

## Organizations & hosts

- `GET /orgs/:orgId`
- `GET /orgs/:orgId/hosts`
- `POST /orgs/:orgId/hosts` `{ name }` → host + **one-time** agent token + install command
- `GET /orgs/:orgId/hosts/:hostId`
- `POST /orgs/:orgId/hosts/:hostId/token/rotate`
- `GET /orgs/:orgId/hosts/:hostId/metrics?from&to&metric`
- `GET /orgs/:orgId/hosts/:hostId/diagnostics`

## Alerts

- `GET /orgs/:orgId/alert-rules`
- `POST /orgs/:orgId/alert-rules`
- `GET /orgs/:orgId/alerts`
- `POST /orgs/:orgId/alerts/:alertId/ack`
- `POST /orgs/:orgId/alerts/:alertId/resolve`
- `POST /orgs/:orgId/silences`

## Integrations & billing

- `GET|POST /orgs/:orgId/integrations`
- `GET /orgs/:orgId/usage`
- `POST /orgs/:orgId/billing/checkout` `{ plan: "pro"|"business" }`
- `POST /billing/webhook` (Stripe signature)

## Ingest (agent Bearer token)

- `GET /v1/agent/config`
- `POST /v1/ingest/heartbeat`
- `POST /v1/ingest/metrics`

Headers: `Authorization: Bearer <token>`, optional `Idempotency-Key`

## Internal support (staff JWT)

- `GET /internal/tenants/search?q=`
- `GET /internal/hosts/:hostId/diagnostics`
- `POST /internal/tenants/:orgId/flags` `{ aiEnabled?, ingestPaused? }`
- `GET /internal/audit`
