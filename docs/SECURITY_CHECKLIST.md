# Security hardening checklist (MVP)

- [x] Agent tokens SHA-256 hashed at rest; plaintext shown once
- [x] Token revoke/rotate supported
- [x] JWT auth on control plane
- [x] Support routes gated by `is_support_staff`
- [x] Webhook SSRF protection (private/metadata IPs)
- [x] Ingest rate limits + idempotency keys
- [x] Org feature flags to pause ingest / disable AI
- [x] Audit log for support and sensitive actions
- [x] Min agent version enforcement (426)
- [ ] Production TLS termination (deploy-time)
- [ ] Secret manager (deploy-time)
- [ ] SOC2 access reviews (later)
