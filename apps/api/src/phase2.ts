/**
 * Phase-2 API extensions loaded from index.ts
 */
import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { and, desc, eq, gte, lte, sql, isNull } from "drizzle-orm";
import {
  users,
  organizations,
  memberships,
  hosts,
  agentTokens,
  alerts,
  aiSummaries,
  alertRules,
  usageDaily,
  auditEvents,
  invites,
  passwordResetTokens,
  logLines,
  metricSamples,
  metricSamples1h,
  integrations,
  hostingerConnections,
  platformMetrics,
  type Db,
} from "@vigilai/db";
import {
  ADMIN_ROLES,
  OWNER_ROLES,
  WRITE_ROLES,
  PLAN_LIMITS,
  roleAllowed,
  type MembershipRole,
} from "@vigilai/shared";
import { z } from "zod";
import { hashPassword, hashToken, verifyPassword } from "./crypto.js";

function encSecret(plain: string): string {
  const key = createHash("sha256")
    .update(process.env.AUTH_SECRET ?? "dev-secret-change-me-32-characters!!")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

function decSecret(packed: string): string {
  const [ivB, tagB, dataB] = packed.split(".");
  const key = createHash("sha256")
    .update(process.env.AUTH_SECRET ?? "dev-secret-change-me-32-characters!!")
    .digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB!, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB!, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB!, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function registerPhase2Routes(
  app: FastifyInstance,
  deps: {
    db: Db;
    requireUser: (req: {
      jwtVerify: () => Promise<void>;
      user: { sub: string; email: string };
    }) => Promise<typeof users.$inferSelect>;
    requireMembership: (
      userId: string,
      orgId: string,
    ) => Promise<typeof memberships.$inferSelect>;
    writeAudit: (
      actorUserId: string | null,
      action: string,
      opts?: {
        orgId?: string | null;
        targetType?: string;
        targetId?: string;
        meta?: Record<string, unknown>;
      },
    ) => Promise<void>;
    generateAgentToken: () => {
      token: string;
      prefix: string;
      hash: string;
    };
  },
) {
  const { db, requireUser, requireMembership, writeAudit, generateAgentToken } =
    deps;

  async function requireRole(
    userId: string,
    orgId: string,
    allowed: MembershipRole[],
  ) {
    const m = await requireMembership(userId, orgId);
    if (!roleAllowed(m.role as MembershipRole, allowed)) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    return m;
  }

  // —— Password reset ——
  app.post("/auth/forgot-password", async (req) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (user) {
      const raw = randomBytes(24).toString("base64url");
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      const link = `${process.env.WEB_URL ?? "http://localhost:3000"}/reset-password?token=${raw}`;
      console.log(`[email:console] To=${user.email} Subject=Reset password ${link}`);
    }
    return { ok: true, message: "If the email exists, a reset link was sent." };
  });

  app.post("/auth/reset-password", async (req, reply) => {
    const body = z
      .object({ token: z.string().min(10), password: z.string().min(8) })
      .parse(req.body);
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(body.token)),
          isNull(passwordResetTokens.usedAt),
          gte(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return reply.code(400).send({ error: "Invalid or expired token" });
    const passwordHash = await hashPassword(body.password);
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    return { ok: true };
  });

  // —— Invites ——
  app.get("/orgs/:orgId/members", async (req) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const rows = await db
      .select({
        membershipId: memberships.id,
        role: memberships.role,
        userId: users.id,
        email: users.email,
        name: users.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId));
    const pending = await db
      .select()
      .from(invites)
      .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt)));
    return { members: rows, invites: pending };
  });

  app.post("/orgs/:orgId/invites", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, ADMIN_ROLES);
    } catch {
      return reply.code(403).send({ error: "Admin required" });
    }
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(["admin", "member", "readonly"]).default("member"),
      })
      .parse(req.body);
    const raw = `inv_${randomBytes(18).toString("base64url")}`;
    const [inv] = await db
      .insert(invites)
      .values({
        orgId,
        email: body.email.toLowerCase(),
        role: body.role,
        tokenHash: hashToken(raw),
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      })
      .returning();
    const link = `${process.env.WEB_URL ?? "http://localhost:3000"}/accept-invite?token=${raw}`;
    console.log(`[email:console] To=${body.email} Subject=VigilAI invite ${link}`);
    await writeAudit(user.id, "invite.create", {
      orgId,
      targetType: "invite",
      targetId: inv!.id,
    });
    return { invite: inv, acceptUrl: link, token: raw };
  });

  app.post("/invites/accept", async (req, reply) => {
    const user = await requireUser(req);
    const body = z.object({ token: z.string().min(8) }).parse(req.body);
    const [inv] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, hashToken(body.token)),
          isNull(invites.acceptedAt),
          gte(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!inv) return reply.code(400).send({ error: "Invalid invite" });
    if (inv.email !== user.email) {
      return reply.code(403).send({ error: "Invite email mismatch" });
    }
    await db
      .insert(memberships)
      .values({ orgId: inv.orgId, userId: user.id, role: inv.role })
      .onConflictDoNothing();
    await db
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(eq(invites.id, inv.id));
    return { ok: true, orgId: inv.orgId };
  });

  // —— Logs ——
  app.get("/orgs/:orgId/hosts/:hostId/logs", async (req) => {
    const user = await requireUser(req);
    const { orgId, hostId } = req.params as { orgId: string; hostId: string };
    await requireMembership(user.id, orgId);
    const q = z
      .object({
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const from = q.from
      ? new Date(q.from)
      : new Date(Date.now() - 60 * 60_000);
    const to = q.to ? new Date(q.to) : new Date();
    const conditions = [
      eq(logLines.hostId, hostId),
      gte(logLines.time, from),
      lte(logLines.time, to),
    ];
    if (q.q) {
      conditions.push(sql`${logLines.message} ILIKE ${"%" + q.q + "%"}`);
    }
    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.orgId, orgId)))
      .limit(1);
    if (!host) return { logs: [] };
    const rows = await db
      .select()
      .from(logLines)
      .where(and(...conditions))
      .orderBy(desc(logLines.time))
      .limit(q.limit);
    return { logs: rows };
  });

  // —— GDPR ——
  app.get("/orgs/:orgId/export", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, ADMIN_ROLES);
    } catch {
      return reply.code(403).send({ error: "Admin required" });
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const hostRows = await db.select().from(hosts).where(eq(hosts.orgId, orgId));
    const alertRows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.orgId, orgId))
      .limit(1000);
    const summaryRows = await db
      .select()
      .from(aiSummaries)
      .where(eq(aiSummaries.orgId, orgId))
      .limit(1000);
    const usage = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.orgId, orgId));
    const members = await db
      .select({
        email: users.email,
        name: users.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId));
    await writeAudit(user.id, "org.export", { orgId });
    return {
      exportedAt: new Date().toISOString(),
      organization: {
        id: org!.id,
        name: org!.name,
        plan: org!.plan,
        createdAt: org!.createdAt,
      },
      members,
      hosts: hostRows.map((h) => ({
        id: h.id,
        name: h.name,
        hostname: h.hostname,
        os: h.os,
        agentVersion: h.agentVersion,
        lastSeenAt: h.lastSeenAt,
      })),
      alerts: alertRows,
      aiSummaries: summaryRows,
      usage,
      note: "Agent tokens and secrets excluded.",
    };
  });

  app.delete("/orgs/:orgId", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, OWNER_ROLES);
    } catch {
      return reply.code(403).send({ error: "Owner required" });
    }
    await writeAudit(user.id, "org.delete", { orgId });
    await db.delete(organizations).where(eq(organizations.id, orgId));
    return { ok: true };
  });

  // —— Slack OAuth ——
  app.get("/orgs/:orgId/integrations/slack/start", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, ADMIN_ROLES);
    } catch {
      return reply.code(403).send({ error: "Admin required" });
    }
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      return reply.code(501).send({
        error: "SLACK_CLIENT_ID not configured",
        hint: "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET",
      });
    }
    const redirect = `${process.env.API_URL ?? "http://localhost:3001"}/integrations/slack/callback`;
    const state = Buffer.from(JSON.stringify({ orgId, uid: user.id })).toString(
      "base64url",
    );
    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=chat:write,channels:read&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
    return { url };
  });

  app.get("/integrations/slack/callback", async (req, reply) => {
    const q = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    const state = JSON.parse(
      Buffer.from(q.state, "base64url").toString("utf8"),
    ) as { orgId: string; uid: string };
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.code(501).send({ error: "Slack not configured" });
    }
    const redirect = `${process.env.API_URL ?? "http://localhost:3001"}/integrations/slack/callback`;
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: q.code,
        redirect_uri: redirect,
      }),
    });
    const data = (await tokenRes.json()) as {
      ok: boolean;
      access_token?: string;
      team?: { id: string; name: string };
      incoming_webhook?: { channel_id?: string };
      error?: string;
    };
    if (!data.ok || !data.access_token) {
      return reply.code(400).send({ error: data.error ?? "oauth failed" });
    }
    await db.insert(integrations).values({
      orgId: state.orgId,
      type: "slack_oauth",
      config: {
        botToken: data.access_token,
        channelId: data.incoming_webhook?.channel_id,
        teamId: data.team?.id,
        teamName: data.team?.name,
      },
    });
    await writeAudit(state.uid, "integration.slack_oauth", {
      orgId: state.orgId,
    });
    return reply.redirect(
      `${process.env.WEB_URL ?? "http://localhost:3000"}/dashboard/integrations?slack=1`,
    );
  });

  // —— Hostinger ——
  app.post("/orgs/:orgId/hostinger/connect", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, ADMIN_ROLES);
    } catch {
      return reply.code(403).send({ error: "Admin required" });
    }
    const body = z
      .object({ apiToken: z.string().min(8), label: z.string().optional() })
      .parse(req.body);
    const [row] = await db
      .insert(hostingerConnections)
      .values({
        orgId,
        apiTokenEnc: encSecret(body.apiToken),
        label: body.label ?? "Hostinger",
      })
      .returning();
    await writeAudit(user.id, "hostinger.connect", { orgId });
    return { connection: { id: row!.id, label: row!.label } };
  });

  app.get("/orgs/:orgId/hostinger/vms", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    await requireMembership(user.id, orgId);
    const [conn] = await db
      .select()
      .from(hostingerConnections)
      .where(eq(hostingerConnections.orgId, orgId))
      .limit(1);
    if (!conn) return reply.code(404).send({ error: "Not connected" });
    const token = decSecret(conn.apiTokenEnc);
    // Hostinger API list VPS — graceful fallback if unreachable
    try {
      const res = await fetch(
        "https://developers.hostinger.com/api/vps/v1/virtual-machines",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        return {
          vms: [],
          warning: `Hostinger API ${res.status}`,
          demo: [
            { id: "demo-1", hostname: "vps-demo-1", plan: "KVM 2" },
            { id: "demo-2", hostname: "vps-demo-2", plan: "KVM 4" },
          ],
        };
      }
      const data = await res.json();
      return { vms: data };
    } catch {
      return {
        vms: [],
        warning: "Hostinger API unreachable",
        demo: [
          { id: "demo-1", hostname: "vps-demo-1", plan: "KVM 2" },
          { id: "demo-2", hostname: "vps-demo-2", plan: "KVM 4" },
        ],
      };
    }
  });

  app.post("/orgs/:orgId/hostinger/import", async (req, reply) => {
    const user = await requireUser(req);
    const { orgId } = req.params as { orgId: string };
    try {
      await requireRole(user.id, orgId, WRITE_ROLES);
    } catch {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const body = z
      .object({ name: z.string().min(1), hostname: z.string().optional() })
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
      return reply.code(402).send({ error: "Host limit reached" });
    }
    const [host] = await db
      .insert(hosts)
      .values({
        orgId,
        name: body.name,
        hostname: body.hostname,
        metadata: { source: "hostinger" },
      })
      .returning();
    const tok = generateAgentToken();
    await db.insert(agentTokens).values({
      orgId,
      hostId: host!.id,
      tokenHash: tok.hash,
      tokenPrefix: tok.prefix,
    });
    const ingestUrl = process.env.INGEST_URL ?? "http://localhost:3002";
    return {
      host,
      token: tok.token,
      installCommand: `curl -fsSL ${process.env.WEB_URL ?? "http://localhost:3000"}/install.sh | sudo bash -s -- --token ${tok.token} --url ${ingestUrl}`,
      note: "Run the install command on the Hostinger VPS (no remote exec).",
    };
  });

  // —— Platform status ——
  app.get("/status/public", async () => {
    let dbOk = true;
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbOk = false;
    }
    const recent = await db
      .select()
      .from(platformMetrics)
      .orderBy(desc(platformMetrics.time))
      .limit(20);
    return {
      status: dbOk ? "operational" : "degraded",
      checks: { database: dbOk },
      metrics: recent,
      updatedAt: new Date().toISOString(),
    };
  });

  // expose requireRole for index to use if needed
  return { requireRole };
}
