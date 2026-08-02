# Runbook: AI empty or wrong

1. Check org flag `aiEnabled`.
2. Check monthly AI quota vs plan (`/dashboard/billing` usage).
3. If `OPENAI_API_KEY` unset, summaries use local fallback templates (expected in dev).
4. Fallback models: `fallback-quota`, `fallback-disabled`, `fallback`.
5. Wrong advice: remind customer to verify with host tools; collect feedback for prompt iteration.
