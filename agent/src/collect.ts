import { readFileSync, existsSync } from "node:fs";
import { cpus, freemem, totalmem, loadavg, hostname, platform, release, uptime } from "node:os";
import { execSync } from "node:child_process";

export const AGENT_VERSION = "0.2.0";

export type CollectedMetrics = Record<string, number>;

function readCpuTimes() {
  const c = cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of c) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

let prevCpu = readCpuTimes();

export function collectCpuUsagePct(): number {
  const cur = readCpuTimes();
  const idleDelta = cur.idle - prevCpu.idle;
  const totalDelta = cur.total - prevCpu.total;
  prevCpu = cur;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

export function collectMemUsedPct(): number {
  const total = totalmem();
  const free = freemem();
  return Math.round(((total - free) / total) * 1000) / 10;
}

export function collectDiskUsedPct(mount = "/"): number | null {
  try {
    if (platform() === "win32") {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-PSDrive -PSProvider FileSystem | Select-Object -First 1 | ForEach-Object { [math]::Round(($_.Used/($_.Used+$_.Free))*100,1) })"`,
        { encoding: "utf8" },
      ).trim();
      const n = Number(out);
      return Number.isFinite(n) ? n : null;
    }
    const out = execSync(`df -P ${mount} | tail -1`, { encoding: "utf8" });
    const parts = out.trim().split(/\s+/);
    const pct = parts[4]?.replace("%", "");
    const n = Number(pct);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function collectMetrics(): CollectedMetrics {
  const metrics: CollectedMetrics = {
    "cpu.usage_pct": collectCpuUsagePct(),
    "mem.used_pct": collectMemUsedPct(),
    "load.1": Math.round((loadavg()[0] ?? 0) * 100) / 100,
    uptime_sec: Math.floor(uptime()),
  };
  const disk = collectDiskUsedPct("/");
  if (disk != null) metrics["disk.used_pct./"] = disk;
  // Network counters are best-effort from /proc on Linux
  try {
    if (existsSync("/proc/net/dev")) {
      const raw = readFileSync("/proc/net/dev", "utf8");
      let bytesIn = 0;
      let bytesOut = 0;
      for (const line of raw.split("\n").slice(2)) {
        const m = line.trim().match(/^(\w+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
        if (!m || m[1] === "lo") continue;
        bytesIn += Number(m[2]);
        bytesOut += Number(m[3]);
      }
      metrics["net.bytes_in"] = bytesIn;
      metrics["net.bytes_out"] = bytesOut;
    }
  } catch {
    // ignore
  }
  return metrics;
}

export function hostMeta() {
  return {
    hostname: hostname(),
    os: `${platform()} ${release()}`,
    agent_version: AGENT_VERSION,
  };
}

export function parseArgs(argv: string[]) {
  const out: {
    token?: string;
    url?: string;
    interval?: number;
    logs?: string[];
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token") out.token = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--interval") out.interval = Number(argv[++i]);
    else if (a === "--logs") {
      out.logs = (argv[++i] ?? "").split(",").filter(Boolean);
    }
  }
  return out;
}

export function readLogTail(paths: string[], maxLines = 20): { path: string; message: string; ts: string }[] {
  const out: { path: string; message: string; ts: string }[] = [];
  const now = new Date().toISOString();
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
      for (const message of lines) {
        out.push({ path: p, message: message.slice(0, 4000), ts: now });
      }
    } catch {
      // ignore
    }
  }
  return out;
}
