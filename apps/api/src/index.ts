import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import {
  createDb,
  users,
  organizations,
  memberships,
  hosts,
  agentTokens,
  alertRules,
  alerts,
  aiSummaries,
  integrations,
  auditEvents,
  usageDaily,
  metricSamples,
  metricSamples1h,
  silenceWindows,
} from "@vigilai/db";
import {
  PLAN_LIMITS,
  WRITE_ROLES,
  hostStatusFromLastSeen,
  roleAllowed,
  type MembershipRole,
} from "@vigilai/shared";
import { z } from "zod";
import Stripe from "stripe";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  generateAgentToken,
  hashPassword,
  hashToken,
  isPrivateOrMetadataUrl,
  verifyPassword,
} from "./crypto.js";
import { registerPhase2Routes } from "./phase2.js";

const db = createDb();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const aiQueue = new Queue("ai-summaries", { connection });
const notifyQueue = new Queue("notifications", { connection });

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

const SUPPORT_EMAILS = (process.env.SUPPORT_STAFF_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

async function writeAudit(
  actorUserId: string | null,
  action: string,
  opts: {
    orgId?: string | null;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, unknown>;
  } = {},
) {
  await db.insert(auditEvents).values({
    actorUserId: actorUserId ?? undefined,
    orgId: opts.orgId ?? undefined,
    action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    meta: opts.meta ?? {},
  });
}

async function requireUser(request: {
  jwtVerify: () => Promise<void>;
  user: { sub: string; email: string };
}) {
  await request.jwtVerify();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, request.user.sub))
    .limit(1);
  if (!user) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  return user;
}

async function requireMembership(userId: string, orgId: string) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  if (!m) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  return m;
}

async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(jwt, {
    secret: process.env.AUTH_SECRET ?? "dev-secret-change-me-32-characters!!",
  });

  app.get("/health", async () => ({ ok: true, service: "api" }));

  // —— Auth ——
  app.post("/auth/register", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1).max(200).optional(),
        orgName: z.string().min(1).max(200).default("My Organization"),
      })
      .parse(req.body);

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (existing.length) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(body.password);
    const isSupport = SUPPORT_EMAILS.includes(body.email.toLowerCase());

    const [user] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        name: body.name ?? body.email.split("@")[0],
        passwordHash,
        isSupportStaff: isSupport,
      })
      .returning();

    const [org] = await db
      .insert(organizations)
      .values({ name: body.orgName })
      .returning();

    await db.insert(memberships).values({
      orgId: org!.id,
      userId: user!.id,
      role: "owner",
    });

    // Default alert rules
    await db.insert(alertRules).values([
      {
        orgId: org!.id,
        name: "High CPU",
        metric: "cpu.usage_pct",
        operator: ">",
        threshold: 90,
        forMinutes: 5,
        severity: "warning",
        ruleType: "threshold",
      },
      {
        orgId: org!.id,
        name: "High Memory",
        metric: "mem.used_pct",
        operator: ">",
        threshold: 90,
        forMinutes: 5,
        severity: "warning",
        ruleType: "threshold",
      },
      {
        orgId: org!.id,
        name: "Disk Almost Full",
        metric: "disk.used_pct./",
        operator: ">",
        threshold: 90,
        forMinutes: 10,
        severity: "critical",
        ruleType: "threshold",
      },
      {
        orgId: org!.id,
        name: "CPU anomaly",
        metric: "cpu.usage_pct",
        operator: ">",
        threshold: 0,
        forMinutes: 1,
        severity: "warning",
        ruleType: "anomaly",
        zscoreThreshold: 3,
      },
      {
        orgId: org!.id,
        name: "Memory anomaly",
        metric: "mem.used_pct",
        operator: ">",
        threshold: 0,
        forMinutes: 1,
        severity: "warning",
        ruleType: "anomaly",
        zscoreThreshold: 3,
      },
    ]);

    await writeAudit(user!.id, "auth.register", { orgId: org!.id });

    const token = app.jwt.sign({
      sub: user!.id,
      email: user!.email,
    });

    return {
      token,
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        isSupportStaff: user!.isSupportStaff,
      },
      org: { id: org!.id, name: org!.name, plan: org!.plan },
    };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email });
    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, user.id));

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSupportStaff: user.isSupportStaff,
      },
      orgs,
    };
  });

  app.get("/auth/me", async (req) => {
    const user = await requireUser(req);
    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, user.id));
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSupportStaff: user.isSupportStaff,
      },
      orgs,
    };
  });

  // —— Orgs ——
  app.get("/orgs/:orgId", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const limits = PLAN_LIMITS[org!.plan];
    const hostCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hosts)
      .where(eq(hosts.orgId, orgId));
    return { org, limits, hostCount: hostCount[0]?.c ?? 0 };
  });

  // —— Hosts ——
  app.get("/orgs/:orgId/hosts", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const rows = await db
      .select()
      .from(hosts)
      .where(eq(hosts.orgId, orgId))
      .orderBy(desc(hosts.createdAt));
    return {
      hosts: rows.map((h) => ({
        ...h,
        computedStatus: hostStatusFromLastSeen(h.lastSeenAt),
      })),
    };
  });

  app.post("/orgs/:orgId/hosts", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    const membership = await requireMembership(user.id, orgId);
    if (!roleAllowed(membership.role as MembershipRole, WRITE_ROLES)) {
      return reply.code(403).send({ error: "Read-only role" });
    }

    const body = z
      .object({ name: z.string().min(1).max(200) })
      .parse(req.body);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const limits = PLAN_LIMITS[org!.plan];
    const countRows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hosts)
      .where(eq(hosts.orgId, orgId));
    if ((countRows[0]?.c ?? 0) >= limits.maxHosts) {
      return reply.code(402).send({
        error: "Host limit reached for plan",
        plan: org!.plan,
        maxHosts: limits.maxHosts,
      });
    }

    const [host] = await db
      .insert(hosts)
      .values({ orgId, name: body.name })
      .returning();

    const tok = generateAgentToken();
    await db.insert(agentTokens).values({
      orgId,
      hostId: host!.id,
      tokenHash: tok.hash,
      tokenPrefix: tok.prefix,
    });

    await writeAudit(user.id, "host.create", {
      orgId,
      targetType: "host",
      targetId: host!.id,
    });

    const ingestUrl = process.env.INGEST_URL ?? "http://localhost:3002";
    const installCommand = `curl -fsSL ${process.env.WEB_URL ?? "http://localhost:3000"}/install.sh | sudo bash -s -- --token ${tok.token} --url ${ingestUrl}`;

    return {
      host,
      token: tok.token,
      tokenPrefix: tok.prefix,
      installCommand,
      note: "Token shown once. Store it securely.",
    };
  });

  app.get("/orgs/:orgId/hosts/:hostId", async (req) => {
    const user = await requireUser(req);
    const { orgId, hostId } = req.params as { orgId: string; hostId: string };
    await requireMembership(user.id, orgId);
    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.orgId, orgId)))
      .limit(1);
    if (!host) return { error: "Not found" };
    return {
      host: {
        ...host,
        computedStatus: hostStatusFromLastSeen(host.lastSeenAt),
      },
    };
  });

  app.post("/orgs/:orgId/hosts/:hostId/token/rotate", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId, hostId } = req.params as { orgId: string; hostId: string };
    const membership = await requireMembership(user.id, orgId);
    if (!["owner", "admin"].includes(membership.role)) {
      return reply.code(403).send({ error: "Admin required" });
    }

    await db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentTokens.hostId, hostId),
          eq(agentTokens.orgId, orgId),
          sql`${agentTokens.revokedAt} IS NULL`,
        ),
      );

    const tok = generateAgentToken();
    await db.insert(agentTokens).values({
      orgId,
      hostId,
      tokenHash: tok.hash,
      tokenPrefix: tok.prefix,
    });

    await writeAudit(user.id, "host.token_rotate", {
      orgId,
      targetType: "host",
      targetId: hostId,
    });

    return { token: tok.token, tokenPrefix: tok.prefix };
  });

  app.get("/orgs/:orgId/hosts/:hostId/metrics", async (req) => {
    const user = await requireUser(req);
    const { orgId, hostId } = req.params as { orgId: string; hostId: string };
    await requireMembership(user.id, orgId);
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        metric: z.string().optional(),
      })
      .parse(req.query);

    const from = q.from
      ? new Date(q.from)
      : new Date(Date.now() - 60 * 60 * 1000);
    const to = q.to ? new Date(q.to) : new Date();
    const rangeMs = to.getTime() - from.getTime();
    const useHourly = rangeMs > 6 * 60 * 60_000;

    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.orgId, orgId)))
      .limit(1);
    if (!host) return { metrics: [], resolution: "raw" };

    if (useHourly) {
      const conditions = [
        eq(metricSamples1h.hostId, hostId),
        gte(metricSamples1h.bucket, from),
        sql`${metricSamples1h.bucket} <= ${to}`,
      ];
      if (q.metric) conditions.push(eq(metricSamples1h.metricName, q.metric));
      const rows = await db
        .select()
        .from(metricSamples1h)
        .where(and(...conditions))
        .orderBy(metricSamples1h.bucket)
        .limit(5000);
      return {
        resolution: "1h",
        metrics: rows.map((r) => ({
          metricName: r.metricName,
          value: r.avgValue,
          min: r.minValue,
          max: r.maxValue,
          time: r.bucket,
        })),
      };
    }

    const conditions = [
      eq(metricSamples.hostId, hostId),
      gte(metricSamples.time, from),
      sql`${metricSamples.time} <= ${to}`,
    ];
    if (q.metric) {
      conditions.push(eq(metricSamples.metricName, q.metric));
    }

    const rows = await db
      .select()
      .from(metricSamples)
      .where(and(...conditions))
      .orderBy(metricSamples.time)
      .limit(5000);

    return { metrics: rows, resolution: "raw" };
  });

  app.get("/orgs/:orgId/hosts/:hostId/diagnostics", async (req) => {
    const user = await requireUser(req);
    const { orgId, hostId } = req.params as { orgId: string; hostId: string };
    await requireMembership(user.id, orgId);
    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.orgId, orgId)))
      .limit(1);
    if (!host) return { error: "Not found" };
    const tokens = await db
      .select({
        id: agentTokens.id,
        prefix: agentTokens.tokenPrefix,
        revokedAt: agentTokens.revokedAt,
        createdAt: agentTokens.createdAt,
      })
      .from(agentTokens)
      .where(eq(agentTokens.hostId, hostId));

    return {
      host: {
        id: host.id,
        name: host.name,
        hostname: host.hostname,
        os: host.os,
        agentVersion: host.agentVersion,
        status: hostStatusFromLastSeen(host.lastSeenAt),
        lastSeenAt: host.lastSeenAt,
        lastError: host.lastError,
        metadata: host.metadata,
      },
      tokens,
      exportedAt: new Date().toISOString(),
      note: "Diagnostics exclude secrets and raw tokens.",
    };
  });

  // —— Alert rules ——
  app.get("/orgs/:orgId/alert-rules", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.orgId, orgId));
    return { rules };
  });

  app.post("/orgs/:orgId/alert-rules", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    const membership = await requireMembership(user.id, orgId);
    if (!roleAllowed(membership.role as MembershipRole, WRITE_ROLES)) {
      return reply.code(403).send({ error: "Read-only" });
    }
    const body = z
      .object({
        name: z.string(),
        metric: z.string(),
        operator: z.enum([">", ">=", "<", "<=", "=="]).default(">"),
        threshold: z.number().default(0),
        forMinutes: z.number().int().min(1).default(5),
        severity: z.enum(["info", "warning", "critical"]).default("warning"),
        hostId: z.string().uuid().optional(),
        channels: z.array(z.string()).default(["email"]),
        ruleType: z.enum(["threshold", "anomaly"]).default("threshold"),
        zscoreThreshold: z.number().default(3),
      })
      .parse(req.body);

    const [rule] = await db
      .insert(alertRules)
      .values({
        orgId,
        name: body.name,
        metric: body.metric,
        operator: body.operator,
        threshold: body.threshold,
        forMinutes: body.forMinutes,
        severity: body.severity,
        hostId: body.hostId,
        channels: body.channels,
        ruleType: body.ruleType,
        zscoreThreshold: body.zscoreThreshold,
      })
      .returning();
    return { rule };
  });

  // —— Alerts ——
  app.get("/orgs/:orgId/alerts", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const q = z
      .object({ status: z.enum(["open", "acknowledged", "resolved"]).optional() })
      .parse(req.query);

    const conditions = [eq(alerts.orgId, orgId)];
    if (q.status) conditions.push(eq(alerts.status, q.status));

    const rows = await db
      .select()
      .from(alerts)
      .where(and(...conditions))
      .orderBy(desc(alerts.firedAt))
      .limit(200);

    const alertIds = rows.map((a) => a.id);
    const summaries =
      alertIds.length > 0
        ? await db
            .select()
            .from(aiSummaries)
            .where(inArray(aiSummaries.alertId, alertIds))
        : [];

    const byAlert = new Map(summaries.map((s) => [s.alertId, s]));
    return {
      alerts: rows.map((a) => ({
        ...a,
        aiSummary: byAlert.get(a.id) ?? null,
      })),
    };
  });

  app.post("/orgs/:orgId/alerts/:alertId/ack", async (req) => {
    const user = await requireUser(req);
    const { orgId, alertId } = req.params as { orgId: string; alertId: string };
    await requireMembership(user.id, orgId);
    const [updated] = await db
      .update(alerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(and(eq(alerts.id, alertId), eq(alerts.orgId, orgId)))
      .returning();
    await writeAudit(user.id, "alert.ack", {
      orgId,
      targetType: "alert",
      targetId: alertId,
    });
    return { alert: updated };
  });

  app.post("/orgs/:orgId/alerts/:alertId/resolve", async (req) => {
    const user = await requireUser(req);
    const { orgId, alertId } = req.params as { orgId: string; alertId: string };
    await requireMembership(user.id, orgId);
    const [updated] = await db
      .update(alerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(and(eq(alerts.id, alertId), eq(alerts.orgId, orgId)))
      .returning();
    return { alert: updated };
  });

  // —— Integrations ——
  app.get("/orgs/:orgId/integrations", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.orgId, orgId));
    return { integrations: rows };
  });

  app.post("/orgs/:orgId/integrations", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const body = z
      .object({
        type: z.enum(["webhook", "email", "slack"]),
        config: z.object({
          url: z.string().url().optional(),
          email: z.string().email().optional(),
          channel: z.string().optional(),
        }),
      })
      .parse(req.body);

    if (body.config.url && isPrivateOrMetadataUrl(body.config.url)) {
      return reply
        .code(400)
        .send({ error: "Webhook URL blocked (private/metadata SSRF protection)" });
    }

    const [row] = await db
      .insert(integrations)
      .values({
        orgId,
        type: body.type,
        config: body.config,
      })
      .returning();
    return { integration: row };
  });

  // —— Silences ——
  app.post("/orgs/:orgId/silences", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const body = z
      .object({
        hostId: z.string().uuid().optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        reason: z.string().optional(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(silenceWindows)
      .values({
        orgId,
        hostId: body.hostId,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        reason: body.reason,
      })
      .returning();
    return { silence: row };
  });

  // —— Usage ——
  app.get("/orgs/:orgId/usage", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const rows = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.orgId, orgId))
      .orderBy(desc(usageDaily.day))
      .limit(30);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return { usage: rows, limits: PLAN_LIMITS[org!.plan], plan: org!.plan };
  });

  // —— Billing ——
  app.post("/orgs/:orgId/billing/checkout", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const body = z
      .object({ plan: z.enum(["pro", "business"]) })
      .parse(req.body);

    if (!stripe) {
      // Dev fallback: upgrade without Stripe
      const [org] = await db
        .update(organizations)
        .set({ plan: body.plan, updatedAt: new Date() })
        .where(eq(organizations.id, orgId))
        .returning();
      await writeAudit(user.id, "billing.dev_upgrade", {
        orgId,
        meta: { plan: body.plan },
      });
      return { mode: "dev", org };
    }

    const priceId =
      body.plan === "pro"
        ? process.env.STRIPE_PRICE_PRO
        : process.env.STRIPE_PRICE_BUSINESS;
    if (!priceId) {
      return reply.code(500).send({ error: "Stripe price not configured" });
    }

    let [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    let customerId = org!.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { orgId },
      });
      customerId = customer.id;
      await db
        .update(organizations)
        .set({ stripeCustomerId: customerId })
        .where(eq(organizations.id, orgId));
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.WEB_URL}/dashboard/billing?success=1`,
      cancel_url: `${process.env.WEB_URL}/dashboard/billing?canceled=1`,
      metadata: { orgId, plan: body.plan },
    });

    return { url: session.url };
  });

  app.post("/billing/webhook", async (req, reply) => {
    if (!stripe) return reply.code(200).send({ ok: true, skipped: true });
    const sig = req.headers["stripe-signature"] as string | undefined;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) {
      return reply.code(400).send({ error: "Missing signature" });
    }
    const raw = (req as { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch {
      return reply.code(400).send({ error: "Invalid signature" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      const plan = session.metadata?.plan as "pro" | "business" | undefined;
      if (orgId && plan) {
        await db
          .update(organizations)
          .set({
            plan,
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));
        await writeAudit(null, "billing.checkout_completed", {
          orgId,
          meta: { plan },
        });
      }
    }
    return { received: true };
  });

  // —— Internal support ——
  app.get("/internal/tenants/search", async (req, reply) => {
    const user = await requireUser(req);
    if (!user.isSupportStaff) {
      return reply.code(403).send({ error: "Support staff only" });
    }
    const q = z.object({ q: z.string().min(1) }).parse(req.query);
    const needle = `%${q.q.toLowerCase()}%`;

    const byEmail = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        orgId: organizations.id,
        orgName: organizations.name,
        plan: organizations.plan,
      })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(sql`lower(${users.email}) LIKE ${needle}`)
      .limit(20);

    const byOrg = await db
      .select()
      .from(organizations)
      .where(sql`lower(${organizations.name}) LIKE ${needle}`)
      .limit(20);

    const byHost = await db
      .select({
        hostId: hosts.id,
        hostName: hosts.name,
        hostname: hosts.hostname,
        orgId: hosts.orgId,
        lastSeenAt: hosts.lastSeenAt,
        agentVersion: hosts.agentVersion,
      })
      .from(hosts)
      .where(
        sql`lower(${hosts.name}) LIKE ${needle} OR lower(coalesce(${hosts.hostname}, '')) LIKE ${needle} OR ${hosts.id}::text = ${q.q}`,
      )
      .limit(20);

    await writeAudit(user.id, "support.search", { meta: { q: q.q } });
    return { byEmail, byOrg, byHost };
  });

  app.get("/internal/hosts/:hostId/diagnostics", async (req, reply) => {
    const user = await requireUser(req);
    if (!user.isSupportStaff) {
      return reply.code(403).send({ error: "Support staff only" });
    }
    const { hostId } = req.params as { hostId: string };
    const [host] = await db.select().from(hosts).where(eq(hosts.id, hostId)).limit(1);
    if (!host) return reply.code(404).send({ error: "Not found" });
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, host.orgId))
      .limit(1);
    await writeAudit(user.id, "support.host_diagnostics", {
      orgId: host.orgId,
      targetType: "host",
      targetId: hostId,
    });
    return {
      host: {
        ...host,
        computedStatus: hostStatusFromLastSeen(host.lastSeenAt),
      },
      org: {
        id: org!.id,
        name: org!.name,
        plan: org!.plan,
        featureFlags: org!.featureFlags,
        stripeCustomerId: org!.stripeCustomerId,
        stripeSubscriptionId: org!.stripeSubscriptionId,
      },
    };
  });

  app.post("/internal/tenants/:orgId/flags", async (req, reply) => {
    const user = await requireUser(req);
    if (!user.isSupportStaff) {
      return reply.code(403).send({ error: "Support staff only" });
    }
    const { orgId } = req.params as { orgId: string };
    const body = z
      .object({
        aiEnabled: z.boolean().optional(),
        ingestPaused: z.boolean().optional(),
      })
      .parse(req.body);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return reply.code(404).send({ error: "Not found" });

    const flags = {
      ...(org.featureFlags ?? {}),
      ...body,
    };
    const [updated] = await db
      .update(organizations)
      .set({ featureFlags: flags, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();

    await writeAudit(user.id, "support.set_flags", {
      orgId,
      meta: body,
    });
    return { org: updated };
  });

  app.get("/internal/audit", async (req, reply) => {
    const user = await requireUser(req);
    if (!user.isSupportStaff) {
      return reply.code(403).send({ error: "Support staff only" });
    }
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(100);
    return { events: rows };
  });

  // Internal helper for workers (shared secret)
  app.get("/internal/ready-queues", async (req, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== (process.env.INTERNAL_API_SECRET ?? "change-me-internal-secret")) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    return {
      aiWaiting: await aiQueue.getWaitingCount(),
      notifyWaiting: await notifyQueue.getWaitingCount(),
    };
  });

  await registerPhase2Routes(app, {
    db,
    requireUser,
    requireMembership,
    writeAudit,
    generateAgentToken,
  });

  return app;
}

const port = Number(process.env.API_PORT ?? 3001);

buildApp()
  .then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      console.log(`API listening on ${port}`);
    }),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export { hashToken };
