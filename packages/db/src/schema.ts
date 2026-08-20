import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "pro", "business"]);
export const roleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
  "readonly",
]);
export const hostStatusEnum = pgEnum("host_status", [
  "pending",
  "online",
  "stale",
  "offline",
]);
export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);
export const alertStatusEnum = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 200 }),
    passwordHash: text("password_hash").notNull(),
    isSupportStaff: boolean("is_support_staff").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uidx").on(t.email)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 120 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 120 }),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  featureFlags: jsonb("feature_flags")
    .$type<{
      aiEnabled?: boolean;
      ingestPaused?: boolean;
    }>()
    .default({ aiEnabled: true, ingestPaused: false }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("memberships_org_user_uidx").on(t.orgId, t.userId)],
);

export const hosts = pgTable(
  "hosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    hostname: varchar("hostname", { length: 255 }),
    os: varchar("os", { length: 120 }),
    agentVersion: varchar("agent_version", { length: 40 }),
    status: hostStatusEnum("status").notNull().default("pending"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("hosts_org_idx").on(t.orgId)],
);

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_tokens_host_idx").on(t.hostId),
    uniqueIndex("agent_tokens_hash_uidx").on(t.tokenHash),
  ],
);

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    metricName: varchar("metric_name", { length: 120 }).notNull(),
    value: doublePrecision("value").notNull(),
    labels: jsonb("labels").$type<Record<string, string>>().default({}),
  },
  (t) => [
    index("metric_samples_host_time_idx").on(t.hostId, t.time),
    index("metric_samples_host_metric_time_idx").on(
      t.hostId,
      t.metricName,
      t.time,
    ),
  ],
);

export const alertRules = pgTable("alert_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  metric: varchar("metric", { length: 120 }).notNull(),
  operator: varchar("operator", { length: 4 }).notNull().default(">"),
  threshold: doublePrecision("threshold").notNull().default(0),
  forMinutes: integer("for_minutes").notNull().default(5),
  severity: alertSeverityEnum("severity").notNull().default("warning"),
  enabled: boolean("enabled").notNull().default(true),
  ruleType: varchar("rule_type", { length: 20 }).notNull().default("threshold"),
  zscoreThreshold: doublePrecision("zscore_threshold").default(3),
  channels: jsonb("channels").$type<string[]>().default(["email"]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => alertRules.id, {
      onDelete: "set null",
    }),
    fingerprint: varchar("fingerprint", { length: 200 }).notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    severity: alertSeverityEnum("severity").notNull().default("warning"),
    title: varchar("title", { length: 300 }).notNull(),
    message: text("message").notNull(),
    observedValue: doublePrecision("observed_value"),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("alerts_org_status_idx").on(t.orgId, t.status),
    index("alerts_fingerprint_idx").on(t.fingerprint),
  ],
);

export const aiSummaries = pgTable("ai_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  alertId: uuid("alert_id")
    .notNull()
    .references(() => alerts.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 80 }).notNull(),
  tokensUsed: integer("tokens_used").notNull().default(0),
  summaryMd: text("summary_md").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 40 }).notNull(),
  config: jsonb("config")
    .$type<{
      url?: string;
      email?: string;
      channel?: string;
      botToken?: string;
      channelId?: string;
      teamId?: string;
      teamName?: string;
    }>()
    .notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const metricBaselines = pgTable(
  "metric_baselines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    metricName: varchar("metric_name", { length: 120 }).notNull(),
    ewma: doublePrecision("ewma").notNull(),
    ewmvar: doublePrecision("ewmvar").notNull().default(0),
    samples: integer("samples").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("metric_baselines_host_metric_uidx").on(
      t.hostId,
      t.metricName,
    ),
  ],
);

export const metricSamples1h = pgTable(
  "metric_samples_1h",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    metricName: varchar("metric_name", { length: 120 }).notNull(),
    avgValue: doublePrecision("avg_value").notNull(),
    minValue: doublePrecision("min_value").notNull(),
    maxValue: doublePrecision("max_value").notNull(),
    sampleCount: integer("sample_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("metric_samples_1h_uidx").on(
      t.hostId,
      t.metricName,
      t.bucket,
    ),
    index("metric_samples_1h_host_bucket_idx").on(t.hostId, t.bucket),
  ],
);

export const logLines = pgTable(
  "log_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    message: text("message").notNull(),
  },
  (t) => [
    index("log_lines_host_time_idx").on(t.hostId, t.time),
    index("log_lines_host_path_time_idx").on(t.hostId, t.path, t.time),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: roleEnum("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("invites_token_hash_uidx").on(t.tokenHash)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("password_reset_token_hash_uidx").on(t.tokenHash)],
);

export const hostingerConnections = pgTable("hostinger_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  apiTokenEnc: text("api_token_enc").notNull(),
  label: varchar("label", { length: 200 }).default("Hostinger"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const platformMetrics = pgTable(
  "platform_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    value: doublePrecision("value").notNull(),
    labels: jsonb("labels").$type<Record<string, string>>().default({}),
    time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_metrics_name_time_idx").on(t.name, t.time)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }),
    targetId: varchar("target_id", { length: 80 }),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_events_org_idx").on(t.orgId)],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: true }).notNull(),
    hostsCounted: integer("hosts_counted").notNull().default(0),
    alertsFired: integer("alerts_fired").notNull().default(0),
    aiCalls: integer("ai_calls").notNull().default(0),
  },
  (t) => [uniqueIndex("usage_daily_org_day_uidx").on(t.orgId, t.day)],
);

export const silenceWindows = pgTable("silence_windows", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
