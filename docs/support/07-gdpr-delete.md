# Runbook: GDPR / data deletion

1. Verify requester identity and org ownership.
2. Export diagnostics/metrics window if requested before delete.
3. Delete organization cascade removes hosts, tokens, metrics, alerts, summaries, usage.
4. Document deletion in audit log / ticket.
5. Confirm Stripe customer deletion if applicable (eng).
