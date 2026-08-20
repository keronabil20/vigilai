import "./env.js";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { and, eq, isNull } from "drizzle-orm";
import {
  createDb,
  agentTokens,
  hosts,
  organizations,
  metricSamples,
  logLines,
} from "@vigilai/db";
import {
  HeartbeatPayloadSchema,
  MetricPayloadSchema,
  LogBatchSchema,
  MIN_SUPPORTED_AGENT,
  compareSemver,
  hostStatusFromLastSeen,
} from "@vigilai/shared";
import { Redis } from "ioredis";

const db = createDb();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const rateWindowMs = 60_000;
const rateLimitPerMin = Number(process.env.INGEST_RATE_LIMIT_PER_MIN ?? 120);

async function checkRateLimit(hostId: string): Promise<boolean> {
  const key = `ingest:rl:${hostId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.pexpire(key, rateWindowMs);
  return n <= rateLimitPerMin;
}

async function resolveAgent(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  const hash = hashToken(token);
  const [row] = await db
    .select({
      tokenId: agentTokens.id,
      hostId: agentTokens.hostId,
      orgId: agentTokens.orgId,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, hash), isNull(agentTokens.revokedAt)))
    .limit(1);
  if (!row) return null;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, row.orgId))
    .limit(1);
  if (!org) return null;
  if (org.featureFlags?.ingestPaused) {
    return { ...row, org, paused: true as const };
  }
  return { ...row, org, paused: false as const };
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "ingest" }));

  app.get("/v1/agent/config", async (req, reply) => {
    const agent = await resolveAgent(req.headers.authorization);
    if (!agent) return reply.code(401).send({ error: "Invalid token" });
    if (agent.paused) {
      return reply.code(403).send({ error: "Ingest paused for organization" });
    }
    return {
      sample_interval_sec: 30,
      heartbeat_interval_sec: 30,
      metrics: [
        "cpu.usage_pct",
        "mem.used_pct",
        "disk.used_pct./",
        "net.bytes_in",
        "net.bytes_out",
        "load.1",
        "uptime_sec",
      ],
      min_supported_agent: MIN_SUPPORTED_AGENT,
    };
  });

  app.post("/v1/ingest/heartbeat", async (req, reply) => {
    const agent = await resolveAgent(req.headers.authorization);
    if (!agent) return reply.code(401).send({ error: "Invalid token" });
    if (agent.paused) {
      return reply.code(403).send({ error: "Ingest paused" });
    }

    const idempotency = req.headers["idempotency-key"] as string | undefined;
    if (idempotency) {
      const key = `ingest:idemp:${agent.hostId}:${idempotency}`;
      const set = await redis.set(key, "1", "EX", 300, "NX");
      if (set !== "OK") {
        return { ok: true, deduped: true };
      }
    }

    if (!(await checkRateLimit(agent.hostId))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const body = HeartbeatPayloadSchema.parse(req.body);
    if (
      body.agent_version &&
      compareSemver(body.agent_version, MIN_SUPPORTED_AGENT) < 0
    ) {
      await db
        .update(hosts)
        .set({
          lastError: `Agent version ${body.agent_version} below minimum ${MIN_SUPPORTED_AGENT}`,
          updatedAt: new Date(),
        })
        .where(eq(hosts.id, agent.hostId));
      return reply.code(426).send({
        error: "Upgrade required",
        min_supported_agent: MIN_SUPPORTED_AGENT,
      });
    }

    const now = new Date();
    await db
      .update(hosts)
      .set({
        lastSeenAt: now,
        status: hostStatusFromLastSeen(now),
        agentVersion: body.agent_version,
        hostname: body.hostname,
        os: body.os,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(hosts.id, agent.hostId));

    return { ok: true };
  });

  app.post("/v1/ingest/metrics", async (req, reply) => {
    const agent = await resolveAgent(req.headers.authorization);
    if (!agent) return reply.code(401).send({ error: "Invalid token" });
    if (agent.paused) {
      return reply.code(403).send({ error: "Ingest paused" });
    }

    const idempotency = req.headers["idempotency-key"] as string | undefined;
    if (idempotency) {
      const key = `ingest:idemp:m:${agent.hostId}:${idempotency}`;
      const set = await redis.set(key, "1", "EX", 300, "NX");
      if (set !== "OK") {
        return { ok: true, deduped: true };
      }
    }

    if (!(await checkRateLimit(agent.hostId))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const body = MetricPayloadSchema.parse(req.body);
    if (
      body.agent_version &&
      compareSemver(body.agent_version, MIN_SUPPORTED_AGENT) < 0
    ) {
      return reply.code(426).send({
        error: "Upgrade required",
        min_supported_agent: MIN_SUPPORTED_AGENT,
      });
    }

    const time = body.ts ? new Date(body.ts) : new Date();
    const rows = Object.entries(body.metrics).map(([metricName, value]) => ({
      hostId: agent.hostId,
      time,
      metricName,
      value,
      labels: body.labels ?? {},
    }));

    if (rows.length) {
      await db.insert(metricSamples).values(rows);
    }

    await db
      .update(hosts)
      .set({
        lastSeenAt: time,
        status: "online",
        agentVersion: body.agent_version,
        hostname: body.hostname,
        os: body.os,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(hosts.id, agent.hostId));

    // Signal workers that new metrics arrived
    await redis.publish(
      "metrics:ingested",
      JSON.stringify({ hostId: agent.hostId, orgId: agent.orgId, time: time.toISOString() }),
    );
    await redis.incr("platform:ingest_count");

    return { ok: true, written: rows.length };
  });

  app.post("/v1/ingest/logs", async (req, reply) => {
    const agent = await resolveAgent(req.headers.authorization);
    if (!agent) return reply.code(401).send({ error: "Invalid token" });
    if (agent.paused) {
      return reply.code(403).send({ error: "Ingest paused" });
    }
    if (!(await checkRateLimit(agent.hostId))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const body = LogBatchSchema.parse(req.body);
    const rows = body.lines.map((l) => ({
      hostId: agent.hostId,
      time: l.ts ? new Date(l.ts) : new Date(),
      path: l.path,
      message: l.message.slice(0, 8000),
    }));
    await db.insert(logLines).values(rows);
    return { ok: true, written: rows.length };
  });

  const port = Number(process.env.INGEST_PORT ?? 3002);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Ingest listening on ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
