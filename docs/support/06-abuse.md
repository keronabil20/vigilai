# Runbook: Suspected abuse

1. Pause ingest (`ingestPaused: true`) via support console.
2. Disable AI if cost spike.
3. Review audit log and alert volume in `usage_daily`.
4. Rate limits on ingest already apply per host.
5. Escalate to eng/security; prepare account suspension if needed.
