# VigilAI — AI VPS Monitoring SaaS

Multi-tenant SaaS for monitoring Linux VPS hosts with threshold/anomaly alerts and AI incident summaries.

## Stack

- **web** — Next.js dashboard + marketing (`apps/web`)
- **api** — Control plane Fastify API (`apps/api`)
- **ingest** — Agent ingest Fastify service (`apps/ingest`)
- **workers** — Alert evaluation, AI summaries, notifications (`apps/workers`)
- **agent** — TypeScript host agent (`agent/`)
- **db** — Drizzle schema + SQL bootstrap (`packages/db`)
- **shared** — Zod contracts + plan limits (`packages/shared`)

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (Postgres 16 + Redis 7). Local defaults: Postgres **5433**, Redis **6399** (see `infra/docker-compose.yml`).

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm --filter @vigilai/shared build
pnpm --filter @vigilai/db build

# terminals
pnpm --filter @vigilai/api dev
pnpm --filter @vigilai/ingest dev
pnpm --filter @vigilai/workers dev
pnpm --filter @vigilai/web dev
```

Open http://localhost:3000 — register, add a host, then:

```bash
pnpm --filter @vigilai/agent start -- --token <TOKEN> --url http://localhost:3002
```

Support staff: register with an email listed in `SUPPORT_STAFF_EMAILS` to access `/internal`.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm docker:up` | Start Postgres + Redis |
| `pnpm db:migrate` | Apply schema |
| `pnpm test` | Unit tests across packages |
| `pnpm typecheck` | Typecheck all packages |

## Docs

- [API](docs/api/README.md)
- [Support runbooks](docs/support/)
- [Launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Load test](tests/load/ingest-k6.js)
- [DPA template](docs/legal/DPA.md)
- Status page: http://localhost:3000/status
