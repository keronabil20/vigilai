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
    aiSummariesPerMonth: number;
    channels: string[];
  }
> = {
  free: {
    maxHosts: 2,
    retentionDays: 14,
    aiSummariesPerMonth: 10,
    channels: ["email"],
  },
  pro: {
    maxHosts: 25,
    retentionDays: 30,
    aiSummariesPerMonth: 200,
    channels: ["email", "webhook", "slack"],
  },
  business: {
    maxHosts: 100,
    retentionDays: 90,
    aiSummariesPerMonth: 1000,
    channels: ["email", "webhook", "slack"],
  },
};

export const STALE_AFTER_MS = 3 * 60 * 1000;
export const OFFLINE_AFTER_MS = 10 * 60 * 1000;
export const MIN_SUPPORTED_AGENT = "0.1.0";

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

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
