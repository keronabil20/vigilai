CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE plan AS ENUM ('free', 'pro', 'business');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'member', 'readonly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE host_status AS ENUM ('pending', 'online', 'stale', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL,
  name varchar(200),
  password_hash text NOT NULL,
  is_support_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  plan plan NOT NULL DEFAULT 'free',
  stripe_customer_id varchar(120),
  stripe_subscription_id varchar(120),
  settings jsonb DEFAULT '{}'::jsonb,
  feature_flags jsonb DEFAULT '{"aiEnabled":true,"ingestPaused":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role membership_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user_uidx ON memberships (org_id, user_id);

CREATE TABLE IF NOT EXISTS hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  hostname varchar(255),
  os varchar(120),
  agent_version varchar(40),
  status host_status NOT NULL DEFAULT 'pending',
  last_seen_at timestamptz,
  last_error text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hosts_org_idx ON hosts (org_id);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_prefix varchar(12) NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tokens_host_idx ON agent_tokens (host_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_hash_uidx ON agent_tokens (token_hash);

CREATE TABLE IF NOT EXISTS metric_samples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  time timestamptz NOT NULL,
  metric_name varchar(120) NOT NULL,
  value double precision NOT NULL,
  labels jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, time)
);
CREATE INDEX IF NOT EXISTS metric_samples_host_time_idx ON metric_samples (host_id, time DESC);
CREATE INDEX IF NOT EXISTS metric_samples_host_metric_time_idx ON metric_samples (host_id, metric_name, time DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  host_id uuid REFERENCES hosts(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  metric varchar(120) NOT NULL,
  operator varchar(4) NOT NULL,
  threshold double precision NOT NULL,
  for_minutes integer NOT NULL DEFAULT 5,
  severity alert_severity NOT NULL DEFAULT 'warning',
  enabled boolean NOT NULL DEFAULT true,
  channels jsonb DEFAULT '["email"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES alert_rules(id) ON DELETE SET NULL,
  fingerprint varchar(200) NOT NULL,
  status alert_status NOT NULL DEFAULT 'open',
  severity alert_severity NOT NULL DEFAULT 'warning',
  title varchar(300) NOT NULL,
  message text NOT NULL,
  observed_value double precision,
  fired_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS alerts_org_status_idx ON alerts (org_id, status);
CREATE INDEX IF NOT EXISTS alerts_fingerprint_idx ON alerts (fingerprint);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model varchar(80) NOT NULL,
  tokens_used integer NOT NULL DEFAULT 0,
  summary_md text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  config jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  target_type varchar(80),
  target_id varchar(80),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_org_idx ON audit_events (org_id);

CREATE TABLE IF NOT EXISTS usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day timestamptz NOT NULL,
  hosts_counted integer NOT NULL DEFAULT 0,
  alerts_fired integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_org_day_uidx ON usage_daily (org_id, day);

CREATE TABLE IF NOT EXISTS silence_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  host_id uuid REFERENCES hosts(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
