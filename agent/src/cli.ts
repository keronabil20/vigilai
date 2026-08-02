import { randomUUID } from "node:crypto";
import { collectMetrics, hostMeta, parseArgs, AGENT_VERSION } from "./collect.js";

async function postJson(
  url: string,
  token: string,
  path: string,
  body: unknown,
) {
  const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      "User-Agent": `vigilai-agent/${AGENT_VERSION}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token ?? process.env.VIGILAI_TOKEN;
  const url =
    args.url ?? process.env.VIGILAI_INGEST_URL ?? "http://localhost:3002";
  const intervalSec = args.interval ?? 30;

  if (!token) {
    console.error("Missing --token or VIGILAI_TOKEN");
    process.exit(1);
  }

  console.log(`VigilAI agent ${AGENT_VERSION} → ${url} every ${intervalSec}s`);

  const meta = hostMeta();

  const tick = async () => {
    try {
      await postJson(url, token, "/v1/ingest/heartbeat", {
        ...meta,
        uptime_sec: Math.floor(process.uptime()),
      });
      const metrics = collectMetrics();
      await postJson(url, token, "/v1/ingest/metrics", {
        ...meta,
        ts: new Date().toISOString(),
        metrics,
      });
      console.log(
        `[ok] cpu=${metrics["cpu.usage_pct"]}% mem=${metrics["mem.used_pct"]}%`,
      );
    } catch (err) {
      console.error("[err]", (err as Error).message);
    }
  };

  await tick();
  setInterval(tick, intervalSec * 1000);
}

main();
