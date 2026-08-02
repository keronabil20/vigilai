/**
 * Playwright e2e outline (install Playwright when ready):
 * 1. Register unique user
 * 2. Create host
 * 3. POST metrics via ingest with token
 * 4. Assert host online + metric cards
 * 5. Force high CPU samples + wait for alert
 * 6. Assert AI summary or fallback present
 *
 * This file documents the flow; wire @playwright/test in CI when browsers available.
 */
export const e2eScenarios = [
  "auth.register",
  "host.create",
  "agent.ingest",
  "alert.fire",
  "ai.summary",
  "support.search",
];
