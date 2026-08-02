# Chaos / reliability drills

Run against a local or staging stack.

## 1. Redis down

```bash
docker stop vigilai-redis
# Observe: ingest rate-limit / pubsub degrade; API may still serve control plane
# Restore:
docker start vigilai-redis
```

Expected: after restore, workers reconnect; new metrics trigger alerts again.

## 2. LLM unavailable

Leave `OPENAI_API_KEY` empty. Fire an alert (high CPU samples).

Expected: `ai_summaries.model` is `fallback` (or `fallback-quota` / `fallback-disabled`).

## 3. Ingest restart

```bash
# restart ingest process
# keep agent running
```

Expected: agent retries; host returns to `online` within one interval.

## 4. Token revoke

Rotate host token via API, then post with old token → 401.

## 5. SSRF webhook

`POST /orgs/:id/integrations` with `http://127.0.0.1/` → 400 blocked.
