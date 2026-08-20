"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Metric = {
  metricName: string;
  value: number;
  time: string;
};

type LogLine = {
  id: string;
  path: string;
  message: string;
  time: string;
};

export default function HostDetailPage() {
  const params = useParams<{ hostId: string }>();
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [tab, setTab] = useState<"metrics" | "logs">("metrics");
  const [host, setHost] = useState<{
    name: string;
    computedStatus: string;
    hostname: string | null;
    agentVersion: string | null;
    lastSeenAt: string | null;
    lastError: string | null;
  } | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logQ, setLogQ] = useState("");

  useEffect(() => {
    if (!orgId) return;
    const load = async () => {
      const h = await api<{ host: typeof host }>(
        `/orgs/${orgId}/hosts/${params.hostId}`,
      );
      setHost(h.host);
      const m = await api<{ metrics: Metric[] }>(
        `/orgs/${orgId}/hosts/${params.hostId}/metrics`,
      );
      setMetrics(m.metrics);
      if (tab === "logs") {
        const l = await api<{ logs: LogLine[] }>(
          `/orgs/${orgId}/hosts/${params.hostId}/logs?q=${encodeURIComponent(logQ)}`,
        );
        setLogs(l.logs);
      }
    };
    load().catch(console.error);
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [orgId, params.hostId, tab, logQ]);

  const byMetric = useMemo(() => {
    const map = new Map<string, Metric[]>();
    for (const m of metrics) {
      const arr = map.get(m.metricName) ?? [];
      arr.push(m);
      map.set(m.metricName, arr);
    }
    return map;
  }, [metrics]);

  async function downloadDiagnostics() {
    if (!orgId) return;
    const data = await api(
      `/orgs/${orgId}/hosts/${params.hostId}/diagnostics`,
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vigilai-diagnostics-${params.hostId}.json`;
    a.click();
  }

  if (!host) return <p>Loading host…</p>;

  return (
    <div>
      <h1>{host.name}</h1>
      <p>
        <span className={`badge ${host.computedStatus}`}>{host.computedStatus}</span>{" "}
        <span className="muted">
          {host.hostname ?? "—"} · agent {host.agentVersion ?? "—"}
        </span>
      </p>
      {host.lastError && (
        <p style={{ color: "var(--danger)" }}>Last error: {host.lastError}</p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          className={tab === "metrics" ? undefined : "secondary"}
          onClick={() => setTab("metrics")}
        >
          Metrics
        </button>
        <button
          type="button"
          className={tab === "logs" ? undefined : "secondary"}
          onClick={() => setTab("logs")}
        >
          Logs
        </button>
        <button type="button" className="secondary" onClick={downloadDiagnostics}>
          Export diagnostics
        </button>
      </div>

      {tab === "metrics" && (
        <div
          className="grid"
          style={{
            marginTop: "1.5rem",
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          }}
        >
          {[...byMetric.entries()].map(([name, points]) => {
            const latest = points[points.length - 1];
            const values = points.map((p) => p.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            return (
              <div className="card" key={name}>
                <div className="muted">{name}</div>
                <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
                  {latest?.value ?? "—"}
                </div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  min {min} · max {max} · {points.length} pts
                </div>
                <Sparkline values={values} />
              </div>
            );
          })}
          {byMetric.size === 0 && (
            <div className="card muted">No metrics yet. Start the agent.</div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="card">
          <div className="field">
            <label>Filter</label>
            <input
              value={logQ}
              onChange={(e) => setLogQ(e.target.value)}
              placeholder="search message"
            />
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Path</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.time).toLocaleString()}</td>
                  <td>{l.path}</td>
                  <td style={{ maxWidth: 420, wordBreak: "break-word" }}>
                    {l.message}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No logs. Run agent with --logs /var/log/syslog
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 220;
  const h = 48;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} style={{ marginTop: 8 }}>
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        points={pts}
      />
    </svg>
  );
}
