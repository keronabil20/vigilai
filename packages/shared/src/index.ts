import { z } from "zod";

export const PlanSchema = z.enum(["free", "pro", "business"]);
export type Plan = z.infer<typeof PlanSchema>;

export const MembershipRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "readonly",
]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const HostStatusSchema = z.enum([
  "pending",
  "online",
  "stale",
  "offline",
]);
export type HostStatus = z.infer<typeof HostStatusSchema>;

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
]);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const MetricPayloadSchema = z.object({
  ts: z.string().datetime().optional(),
  metrics: z.record(z.string(), z.number()),
  labels: z.record(z.string(), z.string()).optional(),
  agent_version: z.string().optional(),
  hostname: z.string().optional(),
  os: z.string().optional(),
});
export type MetricPayload = z.infer<typeof MetricPayloadSchema>;

export const HeartbeatPayloadSchema = z.object({
  agent_version: z.string(),
  hostname: z.string().optional(),
  os: z.string().optional(),
  uptime_sec: z.number().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const LogBatchSchema = z.object({
  lines: z
    .array(
      z.object({
        path: z.string().min(1),
        message: z.string().min(1).max(8000),
        ts: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(500),
  agent_version: z.string().optional(),
});
export type LogBatch = z.infer<typeof LogBatchSchema>;

export const AlertRuleConditionSchema = z.object({
  metric: z.string(),
  operator: z.enum([">", ">=", "<", "<=", "=="]),
  threshold: z.number(),
  for_minutes: z.number().int().min(1).default(5),
});
export type AlertRuleCondition = z.infer<typeof AlertRuleConditionSchema>;

export const AiSummarySchema = z.object({
  summary: z.string(),
  likely_causes: z.array(z.string()),
  recommended_checks: z.array(z.string()),
  severity_assessment: AlertSeveritySchema,
  confidence: z.number().min(0).max(1),
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

export const PLAN_LIMITS: Record<
  Plan,
  {
    maxHosts: number;
    retentionDays: number;
    logRetentionDays: number;
    aiSummariesPerMonth: number;
    channels: string[];
  }
> = {
  free: {
    maxHosts: 2,
    retentionDays: 14,
    logRetentionDays: 3,
    aiSummariesPerMonth: 10,
    channels: ["email"],
  },
  pro: {
    maxHosts: 25,
    retentionDays: 30,
    logRetentionDays: 7,
    aiSummariesPerMonth: 200,
    channels: ["email", "webhook", "slack"],
  },
  business: {
    maxHosts: 100,
    retentionDays: 90,
    logRetentionDays: 14,
    aiSummariesPerMonth: 1000,
    channels: ["email", "webhook", "slack"],
  },
};

export const STALE_AFTER_MS = 3 * 60 * 1000;
export const OFFLINE_AFTER_MS = 10 * 60 * 1000;
export const MIN_SUPPORTED_AGENT = "0.1.0";
export const ANOMALY_METRICS = [
  "cpu.usage_pct",
  "mem.used_pct",
  "load.1",
] as const;
export const DEFAULT_ZSCORE_THRESHOLD = 3.0;
export const EWMA_ALPHA = 0.2;
export const RAW_METRICS_KEEP_HOURS = 24;

export const WRITE_ROLES: MembershipRole[] = ["owner", "admin", "member"];
export const ADMIN_ROLES: MembershipRole[] = ["owner", "admin"];
export const OWNER_ROLES: MembershipRole[] = ["owner"];

export function hostStatusFromLastSeen(
  lastSeenAt: Date | null | undefined,
  now = new Date(),
): HostStatus {
  if (!lastSeenAt) return "pending";
  const age = now.getTime() - lastSeenAt.getTime();
  if (age <= STALE_AFTER_MS) return "online";
  if (age <= OFFLINE_AFTER_MS) return "stale";
  return "offline";
}

export function evaluateCondition(
  value: number,
  operator: AlertRuleCondition["operator"],
  threshold: number,
): boolean {
  switch (operator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    default:
      return false;
  }
}

export function alertFingerprint(
  hostId: string,
  ruleId: string,
  metric: string,
): string {
  return `${hostId}:${ruleId}:${metric}`;
}

export function anomalyFingerprint(hostId: string, metric: string): string {
  return `${hostId}:anomaly:${metric}`;
}

export type EwmaState = { ewma: number; ewmvar: number; samples: number };

/** Update EWMA mean/variance; return z-score vs prior baseline (0 until enough samples). */
export function updateEwma(
  prev: EwmaState | null | undefined,
  value: number,
  alpha = EWMA_ALPHA,
): { state: EwmaState; zscore: number } {
  if (!prev || prev.samples === 0) {
    return {
      state: { ewma: value, ewmvar: 0, samples: 1 },
      zscore: 0,
    };
  }
  const priorStd = Math.sqrt(Math.max(prev.ewmvar, 1e-6));
  const zscore =
    prev.samples < 10 ? 0 : Math.abs(value - prev.ewma) / priorStd;
  const delta = value - prev.ewma;
  const ewma = prev.ewma + alpha * delta;
  const ewmvar = (1 - alpha) * (prev.ewmvar + alpha * delta * delta);
  const samples = prev.samples + 1;
  return { state: { ewma, ewmvar, samples }, zscore };
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function roleAllowed(
  role: MembershipRole,
  allowed: MembershipRole[],
): boolean {
  return allowed.includes(role);
}
