# Beta launch checklist

## Product

- [ ] Signup → create host → agent metrics within 1 minute
- [ ] Default CPU/mem/disk rules present
- [ ] Alert fires and appears in UI
- [ ] AI summary attached (or fallback when no API key)
- [ ] Ack/resolve works
- [ ] Diagnostics export works
- [ ] Billing upgrade works (Stripe test mode or dev fallback)
- [ ] Support search + flags + audit log

## Reliability

- [ ] Ingest load test run (`tests/load/ingest-k6.js`) against staging
- [ ] SLO notes: ingest p99, alert latency, dashboard p95
- [ ] Chaos: stop Redis briefly — services recover
- [ ] Chaos: unset LLM key — fallback summaries

## Security

- [ ] Agent tokens hashed; shown once
- [ ] Token revoke/rotate blocks old token
- [ ] Cross-tenant access denied
- [ ] Webhook SSRF blocklist verified
- [ ] Support staff gating verified

## Docs & support

- [ ] README quick start accurate
- [ ] All runbooks in `docs/support/` reviewed
- [ ] Support SLAs communicated internally
- [ ] `SUPPORT_STAFF_EMAILS` set in prod
- [ ] Secrets rotated from `.env.example` defaults
