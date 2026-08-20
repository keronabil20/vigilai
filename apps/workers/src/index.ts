import "./env.js";
import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  createDb,
  alertRules,
  alerts,
  aiSummaries,
  hosts,
  integrations,
  metricSamples,
  metricSamples1h,
  metricBaselines,
  logLines,
  organizations,
  silenceWindows,
  usageDaily,
  users,
  memberships,
  platformMetrics,
} from "@vigilai/db";
import {
  PLAN_LIMITS,
  RAW_METRICS_KEEP_HOURS,
  ANOMALY_METRICS,
  DEFAULT_ZSCORE_THRESHOLD,
  alertFingerprint,
  anomalyFingerprint,
  evaluateCondition,
  updateEwma,
  type AiSummary,
  type AlertSeverity,
} from "@vigilai/shared";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const subscriber = new Redis(redisUrl);
const db = createDb();

const aiQueue = new Queue("ai-summaries", { connection });
const notifyQueue = new Queue("notifications", { connection });

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function bumpUsage(
  orgId: string,
  field: "alertsFired" | "aiCalls" | "hostsCounted",
  by = 1,
) {
  const day = startOfUtcDay();
  await db
    .insert(usageDaily)
    .values({
      orgId,
      day,
      alertsFired: field === "alertsFired" ? by : 0,
      aiCalls: field === "aiCalls" ? by : 0,
      hostsCounted: field === "hostsCounted" ? by : 0,
    })
    .onConflictDoUpdate({
      target: [usageDaily.orgId, usageDaily.day],
      set: {
        alertsFired:
          field === "alertsFired"
            ? sql`${usageDaily.alertsFired} + ${by}`
            : usageDaily.alertsFired,
        aiCalls:
          field === "aiCalls"
            ? sql`${usageDaily.aiCalls} + ${by}`
            : usageDaily.aiCalls,
        hostsCounted:
          field === "hostsCounted"
            ? sql`${usageDaily.hostsCounted} + ${by}`
            : usageDaily.hostsCounted,
      },
    });
}

async function isSilenced(orgId: string, hostId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(silenceWindows)
    .where(
      and(
        eq(silenceWindows.orgId, orgId),
        lte(silenceWindows.startsAt, now),
        gte(silenceWindows.endsAt, now),
        or(isNull(silenceWindows.hostId), eq(silenceWindows.hostId, hostId)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function latestMetric(hostId: string, metric: string) {
  const [row] = await db
    .select()
    .from(metricSamples)
    .where(
      and(eq(metricSamples.hostId, hostId), eq(metricSamples.metricName, metric)),
    )
    .orderBy(desc(metricSamples.time))
    .limit(1);
  return row;
}

async function metricSustained(
  hostId: string,
  metric: string,
  operator: ">" | ">=" | "<" | "<=" | "==",
  threshold: number,
  forMinutes: number,
) {
  const since = new Date(Date.now() - forMinutes * 60_000);
  const rows = await db
    .select()
    .from(metricSamples)
    .where(
      and(
        eq(metricSamples.hostId, hostId),
        eq(metricSamples.metricName, metric),
        gte(metricSamples.time, since),
      ),
    );
  if (rows.length < 2) return { sustained: false, value: rows[0]?.value };
  const allMatch = rows.every((r) =>
    evaluateCondition(r.value, operator, threshold),
  );
  return {
    sustained: allMatch,
    value: rows[rows.length - 1]?.value,
  };
}

async function fireAlert(opts: {
  orgId: string;
  hostId: string;
  ruleId?: string;
  fingerprint: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  observedValue?: number;
}) {
  const [existing] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.fingerprint, opts.fingerprint),
        inArray(alerts.status, ["open", "acknowledged"]),
      ),
    )
    .limit(1);
  if (existing) return existing;

  try {
    const [alert] = await db
      .insert(alerts)
      .values({
        orgId: opts.orgId,
        hostId: opts.hostId,
        ruleId: opts.ruleId,
        fingerprint: opts.fingerprint,
        status: "open",
        severity: opts.severity,
        title: opts.title,
        message: opts.message,
        observedValue: opts.observedValue,
      })
      .returning();
    await bumpUsage(opts.orgId, "alertsFired");
    await connection.incr("platform:alerts_fired");
    await notifyQueue.add("alert", { alertId: alert!.id }, { jobId: `notify:${alert!.id}` });
    await aiQueue.add("summarize", { alertId: alert!.id }, { jobId: `ai:${alert!.id}` });
    return alert!;
  } catch (err) {
    // Unique open-fingerprint race
    const [again] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.fingerprint, opts.fingerprint),
          inArray(alerts.status, ["open", "acknowledged"]),
        ),
      )
      .limit(1);
    if (again) return again;
    throw err;
  }
}

async function evaluateAnomalies(hostId: string, orgId: string) {
  const anomalyRules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.orgId, orgId),
        eq(alertRules.enabled, true),
        eq(alertRules.ruleType, "anomaly"),
        or(isNull(alertRules.hostId), eq(alertRules.hostId, hostId)),
      ),
    );

  for (const metric of ANOMALY_METRICS) {
    const latest = await latestMetric(hostId, metric);
    if (!latest) continue;
    const [prev] = await db
      .select()
      .from(metricBaselines)
      .where(
        and(
          eq(metricBaselines.hostId, hostId),
          eq(metricBaselines.metricName, metric),
        ),
      )
      .limit(1);
    const { state, zscore } = updateEwma(
      prev
        ? { ewma: prev.ewma, ewmvar: prev.ewmvar, samples: prev.samples }
        : null,
      latest.value,
    );
    if (prev) {
      await db
        .update(metricBaselines)
        .set({
          ewma: state.ewma,
          ewmvar: state.ewmvar,
          samples: state.samples,
          updatedAt: new Date(),
        })
        .where(eq(metricBaselines.id, prev.id));
    } else {
      await db.insert(metricBaselines).values({
        hostId,
        metricName: metric,
        ewma: state.ewma,
        ewmvar: state.ewmvar,
        samples: state.samples,
      });
    }

    const matchingRule = anomalyRules.find((r) => r.metric === metric);
    if (!matchingRule) continue;

    const threshold =
      matchingRule.zscoreThreshold ?? DEFAULT_ZSCORE_THRESHOLD;
    const fp = anomalyFingerprint(hostId, metric);
    const [open] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.fingerprint, fp),
          inArray(alerts.status, ["open", "acknowledged"]),
        ),
      )
      .limit(1);

    const anomalous = zscore >= threshold;
    if (anomalous) {
      if (open) continue;
      await fireAlert({
        orgId,
        hostId,
        ruleId: matchingRule.id,
        fingerprint: fp,
        severity: matchingRule.severity,
        title: matchingRule.name,
        message: `${metric} z-score ${zscore.toFixed(2)} ≥ ${threshold} (value ${latest.value}, baseline ${state.ewma.toFixed(2)})`,
        observedValue: latest.value,
      });
    } else if (open) {
      await db
        .update(alerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(alerts.id, open.id));
    }
  }
}

async function evaluateHost(hostId: string, orgId: string) {
  if (await isSilenced(orgId, hostId)) return;

  await evaluateAnomalies(hostId, orgId);

  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.orgId, orgId),
        eq(alertRules.enabled, true),
        or(isNull(alertRules.hostId), eq(alertRules.hostId, hostId)),
      ),
    );

  for (const rule of rules) {
    if ((rule.ruleType ?? "threshold") === "anomaly") continue;
    const op = rule.operator as ">" | ">=" | "<" | "<=" | "==";
    const { sustained, value } = await metricSustained(
      hostId,
      rule.metric,
      op,
      rule.threshold,
      rule.forMinutes,
    );
    const fp = alertFingerprint(hostId, rule.id, rule.metric);

    const [open] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.fingerprint, fp),
          inArray(alerts.status, ["open", "acknowledged"]),
        ),
      )
      .limit(1);

    if (sustained && value !== undefined) {
      if (open) continue;
      await fireAlert({
        orgId,
        hostId,
        ruleId: rule.id,
        fingerprint: fp,
        severity: rule.severity,
        title: rule.name,
        message: `${rule.metric} ${rule.operator} ${rule.threshold} (observed ${value}) for ${rule.forMinutes}m`,
        observedValue: value,
      });
    } else if (open && !sustained) {
      await db
        .update(alerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(alerts.id, open.id));
    }
  }
}

function fallbackAiSummary(
  title: string,
  message: string,
  observedValue: number | null,
  severity: AlertSeverity,
): AiSummary {
  return {
    summary: `Alert "${title}" fired. ${message}. This summary was generated locally because the LLM was unavailable or the org AI quota was reached.`,
    likely_causes: [
      observedValue != null
        ? `Observed metric value ${observedValue} crossed the configured threshold.`
        : "Metric crossed the configured threshold.",
      "Recent workload spike, misconfiguration, or resource leak.",
    ],
    recommended_checks: [
      "Inspect top CPU/memory processes on the host (top/htop).",
      "Check disk usage and inode exhaustion (df -h).",
      "Review recent deploys and cron jobs.",
      "Confirm the monitoring agent is healthy and timestamps are correct.",
    ],
    severity_assessment: severity,
    confidence: 0.4,
  };
}

async function generateAiSummary(alertId: string) {
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, alertId)).limit(1);
  if (!alert) return;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, alert.orgId))
    .limit(1);
  if (!org) return;
  if (org.featureFlags?.aiEnabled === false) {
    const fb = fallbackAiSummary(
      alert.title,
      alert.message,
      alert.observedValue,
      alert.severity,
    );
    await db.insert(aiSummaries).values({
      alertId,
      orgId: alert.orgId,
      model: "fallback-disabled",
      tokensUsed: 0,
      summaryMd: formatSummaryMd(fb),
      payload: fb,
    });
    return;
  }

  const limits = PLAN_LIMITS[org.plan];
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const usage = await db
    .select({ total: sql<number>`coalesce(sum(${usageDaily.aiCalls}),0)::int` })
    .from(usageDaily)
    .where(
      and(eq(usageDaily.orgId, alert.orgId), gte(usageDaily.day, monthStart)),
    );
  const used = usage[0]?.total ?? 0;
  if (used >= limits.aiSummariesPerMonth) {
    const fb = fallbackAiSummary(
      alert.title,
      alert.message,
      alert.observedValue,
      alert.severity,
    );
    await db.insert(aiSummaries).values({
      alertId,
      orgId: alert.orgId,
      model: "fallback-quota",
      tokensUsed: 0,
      summaryMd: formatSummaryMd(fb),
      payload: fb,
    });
    return;
  }

  const [host] = await db.select().from(hosts).where(eq(hosts.id, alert.hostId)).limit(1);
  const since = new Date(Date.now() - 30 * 60_000);
  const recent = await db
    .select()
    .from(metricSamples)
    .where(
      and(eq(metricSamples.hostId, alert.hostId), gte(metricSamples.time, since)),
    )
    .orderBy(desc(metricSamples.time))
    .limit(200);

  const context = {
    alert: {
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      observedValue: alert.observedValue,
    },
    host: host
      ? {
        name: host.name,
        hostname: host.hostname,
        os: host.os,
        agentVersion: host.agentVersion,
      }
      : null,
    recentMetrics: recent.map((r) => ({
      metric: r.metricName,
      value: r.value,
      time: r.time,
    })),
  };

  let summary: AiSummary;
  let model = "fallback";
  let tokensUsed = 0;
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL ?? "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are VigilAI, an assistant for VPS monitoring. Return JSON with keys: summary, likely_causes (array), recommended_checks (array), severity_assessment (info|warning|critical), confidence (0-1). Never invent metric values; only use provided observations. Be concise.",
            },
            {
              role: "user",
              content: JSON.stringify(context),
            },
          ],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices: { message: { content: string } }[];
          usage?: { total_tokens?: number };
        };
        const parsed = JSON.parse(data.choices[0]!.message.content) as AiSummary;
        summary = parsed;
        model = process.env.AI_MODEL ?? "gpt-4o-mini";
        tokensUsed = data.usage?.total_tokens ?? 0;
      } else {
        summary = fallbackAiSummary(
          alert.title,
          alert.message,
          alert.observedValue,
          alert.severity,
        );
      }
    } catch {
      summary = fallbackAiSummary(
        alert.title,
        alert.message,
        alert.observedValue,
        alert.severity,
      );
    }
  } else {
    summary = fallbackAiSummary(
      alert.title,
      alert.message,
      alert.observedValue,
      alert.severity,
    );
  }

  await db.insert(aiSummaries).values({
    alertId,
    orgId: alert.orgId,
    model,
    tokensUsed,
    summaryMd: formatSummaryMd(summary),
    payload: summary,
  });
  await bumpUsage(alert.orgId, "aiCalls");
}

function formatSummaryMd(s: AiSummary): string {
  return [
    s.summary,
    "",
    "### Likely causes",
    ...s.likely_causes.map((c) => `- ${c}`),
    "",
    "### Recommended checks",
    ...s.recommended_checks.map((c) => `- ${c}`),
    "",
    `Severity: **${s.severity_assessment}** · Confidence: ${(s.confidence * 100).toFixed(0)}%`,
  ].join("\n");
}

async function deliverNotification(alertId: string) {
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, alertId)).limit(1);
  if (!alert) return;

  const [summary] = await db
    .select()
    .from(aiSummaries)
    .where(eq(aiSummaries.alertId, alertId))
    .limit(1);

  const ints = await db
    .select()
    .from(integrations)
    .where(
      and(eq(integrations.orgId, alert.orgId), eq(integrations.enabled, true)),
    );

  const payload = {
    alert: {
      id: alert.id,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      firedAt: alert.firedAt,
    },
    aiSummary: summary?.payload ?? null,
  };

  // Always log
  console.log("[notify]", JSON.stringify(payload));

  // Email owners if no integrations — look up membership emails
  if (ints.length === 0) {
    const owners = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.orgId, alert.orgId),
          inArray(memberships.role, ["owner", "admin"]),
        ),
      );
    for (const o of owners) {
      console.log(`[email:console] To=${o.email} Subject=[VigilAI] ${alert.title}`);
    }
  }

  for (const integ of ints) {
    if (integ.type === "webhook" || integ.type === "slack") {
      const url = integ.config.url;
      if (!url) continue;
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Webhook delivery failed", err);
      }
    }
    if (integ.type === "slack_oauth" && integ.config.botToken && integ.config.channelId) {
      try {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${integ.config.botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: integ.config.channelId,
            text: `[VigilAI] ${alert.title}: ${alert.message}`,
          }),
        });
      } catch (err) {
        console.error("Slack OAuth delivery failed", err);
      }
    }
    if (integ.type === "email" && integ.config.email) {
      console.log(
        `[email:console] To=${integ.config.email} Subject=[VigilAI] ${alert.title}`,
      );
    }
  }

  await db
    .update(alerts)
    .set({ notifiedAt: new Date() })
    .where(eq(alerts.id, alertId));
}

async function evaluateHostSilent() {
  const staleBefore = new Date(Date.now() - 3 * 60_000);
  const rows = await db
    .select()
    .from(hosts)
    .where(
      and(
        sql`${hosts.lastSeenAt} IS NOT NULL`,
        lte(hosts.lastSeenAt, staleBefore),
      ),
    );

  for (const host of rows) {
    if (await isSilenced(host.orgId, host.id)) continue;
    const fp = `silent:${host.id}`;
    const ageMin = host.lastSeenAt
      ? Math.round((Date.now() - host.lastSeenAt.getTime()) / 60000)
      : 0;
    await fireAlert({
      orgId: host.orgId,
      hostId: host.id,
      fingerprint: fp,
      severity: "critical",
      title: "Host silent",
      message: `No heartbeat from ${host.name} for ~${ageMin} minutes`,
    });
  }
}

async function meterHosts() {
  const orgs = await db.select().from(organizations);
  for (const org of orgs) {
    const count = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hosts)
      .where(eq(hosts.orgId, org.id));
    await bumpUsage(org.id, "hostsCounted", count[0]?.c ?? 0);
  }
}

async function downsampleAndRetain() {
  const cutoffRaw = new Date(Date.now() - RAW_METRICS_KEEP_HOURS * 3600_000);
  // Aggregate raw samples older than 24h into hourly buckets
  await db.execute(sql`
    INSERT INTO metric_samples_1h (id, host_id, bucket, metric_name, avg_value, min_value, max_value, sample_count)
    SELECT gen_random_uuid(), host_id,
           date_trunc('hour', time) AS bucket,
           metric_name,
           avg(value), min(value), max(value), count(*)::int
    FROM metric_samples
    WHERE time < ${cutoffRaw}
    GROUP BY host_id, date_trunc('hour', time), metric_name
    ON CONFLICT (host_id, metric_name, bucket)
    DO UPDATE SET
      avg_value = EXCLUDED.avg_value,
      min_value = EXCLUDED.min_value,
      max_value = EXCLUDED.max_value,
      sample_count = EXCLUDED.sample_count
  `);

  await db.delete(metricSamples).where(lte(metricSamples.time, cutoffRaw));

  const orgs = await db.select().from(organizations);
  for (const org of orgs) {
    const limits = PLAN_LIMITS[org.plan];
    const metricCutoff = new Date(
      Date.now() - limits.retentionDays * 24 * 3600_000,
    );
    const logCutoff = new Date(
      Date.now() - limits.logRetentionDays * 24 * 3600_000,
    );
    const orgHosts = await db
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.orgId, org.id));
    const ids = orgHosts.map((h) => h.id);
    if (!ids.length) continue;
    await db
      .delete(metricSamples1h)
      .where(
        and(
          inArray(metricSamples1h.hostId, ids),
          lte(metricSamples1h.bucket, metricCutoff),
        ),
      );
    await db
      .delete(logLines)
      .where(
        and(inArray(logLines.hostId, ids), lte(logLines.time, logCutoff)),
      );
  }
  console.log("[retention] downsample + purge complete");
}

async function recordPlatformSnapshot() {
  const alertsFired = Number((await connection.get("platform:alerts_fired")) ?? 0);
  const ingestCount = Number((await connection.get("platform:ingest_count")) ?? 0);
  await db.insert(platformMetrics).values([
    { name: "alerts_fired_total", value: alertsFired, time: new Date() },
    { name: "ingest_count_total", value: ingestCount, time: new Date() },
  ]);
}

async function pageIfUnhealthy() {
  const key = process.env.PAGERDUTY_ROUTING_KEY;
  if (!key) return;
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: key,
        event_action: "trigger",
        payload: {
          summary: "VigilAI platform: database unreachable",
          severity: "critical",
          source: "vigilai-workers",
        },
      }),
    });
  }
}

// Workers
new Worker(
  "ai-summaries",
  async (job) => {
    await generateAiSummary(job.data.alertId as string);
  },
  { connection },
);

new Worker(
  "notifications",
  async (job) => {
    await new Promise((r) => setTimeout(r, 500));
    await deliverNotification(job.data.alertId as string);
  },
  { connection },
);

subscriber.subscribe("metrics:ingested");
subscriber.on("message", async (_channel: string, message: string) => {
  try {
    const { hostId, orgId } = JSON.parse(message) as {
      hostId: string;
      orgId: string;
    };
    await evaluateHost(hostId, orgId);
  } catch (err) {
    console.error("evaluateHost failed", err);
  }
});

setInterval(() => {
  evaluateHostSilent().catch(console.error);
}, 60_000);

setInterval(() => {
  meterHosts().catch(console.error);
}, 60 * 60_000);

setInterval(() => {
  downsampleAndRetain().catch(console.error);
}, 6 * 60 * 60_000);

setInterval(() => {
  recordPlatformSnapshot().catch(console.error);
  pageIfUnhealthy().catch(console.error);
}, 5 * 60_000);

console.log("Workers started (alerts, AI, notifications, metering, retention)");

export {
  evaluateCondition,
  fallbackAiSummary,
  formatSummaryMd,
  metricSustained,
  updateEwma,
  fireAlert,
};
