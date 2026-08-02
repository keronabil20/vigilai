"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Metric = {
  metricName: string;
  value: number;
  time: string;
};

export default function HostDetailPage() {
  const params = useParams<{ hostId: string }>();
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [host, setHost] = useState<{
    name: string;
    computedStatus: string;
    hostname: string | null;
    agentVersion: string | null;
    lastSeenAt: string | null;
    lastError: string | null;
  } | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);

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
    };
    load().catch(console.error);
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [orgId, params.hostId]);

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
      <button type="button" className="secondary" onClick={downloadDiagnostics}>
        Export diagnostics
      </button>

      <div className="grid" style={{ marginTop: "1.5rem", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
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
