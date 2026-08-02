/**
 * End-to-end smoke against local API + ingest.
 * Usage: npx tsx tests/e2e/smoke.ts
 */
const API = process.env.API_URL ?? "http://localhost:3001";
const INGEST = process.env.INGEST_URL ?? "http://localhost:3002";

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${url} ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const email = `smoke_${Date.now()}@vigilai.local`;
  const reg = await json(`${API}/auth/register`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "password123",
      name: "Smoke",
      orgName: "Smoke Org",
    }),
  });
  const token = reg.token as string;
  const orgId = reg.org.id as string;

  const hostRes = await json(`${API}/orgs/${orgId}/hosts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: "smoke-host" }),
  });
  const agentToken = hostRes.token as string;

  await json(`${INGEST}/v1/ingest/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      agent_version: "0.1.0",
      hostname: "smoke",
      os: "linux",
    }),
  });

  // Push high CPU samples for alerting
  for (let i = 0; i < 6; i++) {
    await json(`${INGEST}/v1/ingest/metrics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({
        agent_version: "0.1.0",
        ts: new Date().toISOString(),
        metrics: {
          "cpu.usage_pct": 95,
          "mem.used_pct": 50,
          "disk.used_pct./": 40,
          "load.1": 2,
        },
      }),
    });
  }

  // Dev billing upgrade
  const bill = await json(`${API}/orgs/${orgId}/billing/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan: "pro" }),
  });

  const hosts = await json(`${API}/orgs/${orgId}/hosts`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        orgId,
        hostStatus: hosts.hosts[0]?.computedStatus,
        billingMode: bill.mode ?? "stripe",
        plan: bill.org?.plan,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
