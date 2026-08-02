# Runbook: Agent offline

**Symptoms:** Host status `stale`/`offline`, no metrics, customer reports missing data.

## Checks (support console)

1. Search tenant by email/org/host id.
2. Open host diagnostics: `lastSeenAt`, `agentVersion`, `lastError`.
3. Confirm org feature flag `ingestPaused` is false.
4. Confirm plan/Stripe is active (not past_due if Stripe enabled).

## Customer-side checklist

1. Agent process running (`systemctl status vigilai-agent` or `ps`).
2. Outbound HTTPS to ingest URL on 443/3002 allowed by firewall.
3. Token not rotated/revoked — if unsure, rotate and reinstall with new token.
4. Clock skew: NTP sync (`timedatectl`). Large skew can confuse dashboards.
5. Disk full on customer host preventing agent writes/logs.

## Platform-side

1. Ingest `/health` OK.
2. Redis/Postgres healthy.
3. Ingest rate-limit 429s in logs for that host.

## Resolution

- Resume ingest flag if paused.
- Provide rotate-token + install command (never ask customer to paste old token back).
- Escalate to eng if ingest 5xx cluster-wide.
