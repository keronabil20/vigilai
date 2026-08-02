# Runbook: Platform incident

**Priority:** Protect ingest availability first; degrade AI second.

1. Update status page / incident channel.
2. Check `/health` on api, ingest; Redis/Postgres.
3. If LLM provider outage: fallback summaries already exist — announce degraded AI.
4. If ingest outage: page on-call; scale/restart ingest workers.
5. After restore: verify agent reconnects; clear customer communications.
6. P1 ack SLA: 15 minutes.
