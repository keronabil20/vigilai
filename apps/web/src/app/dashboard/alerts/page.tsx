"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Alert = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  firedAt: string;
  aiSummary: {
    summaryMd: string;
    model: string;
  } | null;
};

export default function AlertsPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [alerts, setAlerts] = useState<Alert[]>([]);

  async function load() {
    if (!orgId) return;
    const res = await api<{ alerts: Alert[] }>(`/orgs/${orgId}/alerts`);
    setAlerts(res.alerts);
  }

  useEffect(() => {
    load().catch(console.error);
    const t = setInterval(() => load().catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [orgId]);

  async function ack(id: string) {
    if (!orgId) return;
    await api(`/orgs/${orgId}/alerts/${id}/ack`, { method: "POST" });
    await load();
  }

  async function resolve(id: string) {
    if (!orgId) return;
    await api(`/orgs/${orgId}/alerts/${id}/resolve`, { method: "POST" });
    await load();
  }

  return (
    <div>
      <h1>Alerts</h1>
      <p className="muted">
        AI summaries are assistive — verify with host checks before acting.
      </p>
      <div className="grid" style={{ marginTop: "1.25rem" }}>
        {alerts.map((a) => (
          <div className="card" key={a.id}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className={`badge ${a.severity}`}>{a.severity}</span>
              <span className="badge">{a.status}</span>
              <strong style={{ marginLeft: "0.25rem" }}>{a.title}</strong>
            </div>
            <p className="muted">{a.message}</p>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {new Date(a.firedAt).toLocaleString()}
            </p>
            {a.aiSummary && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  background: "rgba(0,0,0,0.25)",
                  padding: "1rem",
                  borderRadius: 12,
                  fontSize: "0.9rem",
                }}
              >
                {a.aiSummary.summaryMd}
                {"\n\n"}
                <span className="muted">model: {a.aiSummary.model}</span>
              </pre>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              {a.status === "open" && (
                <button type="button" className="secondary" onClick={() => ack(a.id)}>
                  Acknowledge
                </button>
              )}
              {a.status !== "resolved" && (
                <button type="button" onClick={() => resolve(a.id)}>
                  Resolve
                </button>
              )}
            </div>
          </div>
        ))}
        {alerts.length === 0 && <div className="card muted">No alerts yet.</div>}
      </div>
    </div>
  );
}
