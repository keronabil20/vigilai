# Runbook: Missing metrics

**Symptoms:** Heartbeat online but charts empty, or intermittent gaps.

1. Confirm agent posts to `/v1/ingest/metrics` (agent logs `[ok]`).
2. Check ingest 401 (bad token) vs 429 (rate limit) vs 426 (upgrade agent).
3. Query recent `metric_samples` for host via dashboard host page.
4. Customer disk full / collector failures (disk metric null on Windows is expected for `/`).
5. Org retention may have pruned older data — explain plan limits.
