# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/ingest/package.json apps/ingest/
COPY apps/workers/package.json apps/workers/
COPY apps/web/package.json apps/web/
COPY agent/package.json agent/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps ./apps
COPY agent ./agent
ARG NEXT_PUBLIC_API_URL=https://VigilAI.ift-solutions.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @vigilai/shared build \
 && pnpm --filter @vigilai/db build \
 && pnpm --filter @vigilai/api build \
 && pnpm --filter @vigilai/ingest build \
 && pnpm --filter @vigilai/workers build \
 && pnpm --filter @vigilai/web build \
 && pnpm --filter @vigilai/agent build

# —— API ——
FROM base AS api
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/src/bootstrap.sql ./packages/db/dist/bootstrap.sql
COPY --from=build /app/packages/db/src/bootstrap.sql ./packages/db/src/bootstrap.sql
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY package.json pnpm-workspace.yaml ./
COPY infra/docker-entrypoint-api.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3001
CMD ["/entrypoint.sh"]

# —— Ingest ——
FROM base AS ingest
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/ingest/node_modules ./apps/ingest/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/apps/ingest/dist ./apps/ingest/dist
COPY --from=build /app/apps/ingest/package.json ./apps/ingest/
COPY package.json pnpm-workspace.yaml ./
EXPOSE 3002
CMD ["node", "apps/ingest/dist/index.js"]

# —— Workers ——
FROM base AS workers
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/apps/workers/dist ./apps/workers/dist
COPY --from=build /app/apps/workers/package.json ./apps/workers/
COPY package.json pnpm-workspace.yaml ./
CMD ["node", "apps/workers/dist/index.js"]

# —— Web ——
FROM base AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/next.config.ts ./apps/web/
COPY --from=build /app/packages/shared ./packages/shared
COPY package.json pnpm-workspace.yaml ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
