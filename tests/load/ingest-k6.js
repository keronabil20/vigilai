import http from "k6/http";
import { check, sleep } from "k6";

/**
 * Load test ingest endpoint.
 * Env: INGEST_URL, AGENT_TOKEN
 *
 * Example:
 *   k6 run -e INGEST_URL=http://localhost:3002 -e AGENT_TOKEN=vag_xxx tests/load/ingest-k6.js
 */
export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(99)<500"],
    http_req_failed: ["rate<0.05"],
  },
};

const url = __ENV.INGEST_URL || "http://localhost:3002";
const token = __ENV.AGENT_TOKEN || "";

export default function () {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `${__VU}-${__ITER}-${Date.now()}`,
  };

  const hb = http.post(
    `${url}/v1/ingest/heartbeat`,
    JSON.stringify({
      agent_version: "0.1.0",
      hostname: `k6-vu-${__VU}`,
      os: "linux",
    }),
    { headers },
  );
  check(hb, { "heartbeat 200": (r) => r.status === 200 });

  const metrics = http.post(
    `${url}/v1/ingest/metrics`,
    JSON.stringify({
      agent_version: "0.1.0",
      ts: new Date().toISOString(),
      metrics: {
        "cpu.usage_pct": 10 + (__ITER % 50),
        "mem.used_pct": 40,
        "load.1": 0.5,
      },
    }),
    { headers },
  );
  check(metrics, { "metrics 200": (r) => r.status === 200 });
  sleep(1);
}
