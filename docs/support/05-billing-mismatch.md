# Runbook: Billing mismatch

1. Compare org `plan` in DB vs Stripe subscription (if configured).
2. Dev mode without Stripe: checkout endpoint upgrades plan locally — document in ticket.
3. Re-run usage metering (hourly worker) or wait for next cycle.
4. Host limit 402 on create host → guide upgrade.
5. Never manually edit Stripe from support without eng approval.
