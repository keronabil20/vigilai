"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function BillingPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [usage, setUsage] = useState<{
    plan: string;
    limits: {
      maxHosts: number;
      retentionDays: number;
      aiSummariesPerMonth: number;
    };
    usage: { day: string; hostsCounted: number; alertsFired: number; aiCalls: number }[];
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    api<typeof usage>(`/orgs/${orgId}/usage`).then(setUsage).catch(console.error);
  }, [orgId]);

  async function upgrade(plan: "pro" | "business") {
    if (!orgId) return;
    const res = await api<{ url?: string; mode?: string; org?: { plan: string } }>(
      `/orgs/${orgId}/billing/checkout`,
      { method: "POST", body: JSON.stringify({ plan }) },
    );
    if (res.url) {
      window.location.href = res.url;
      return;
    }
    setMsg(`Upgraded to ${res.org?.plan ?? plan} (dev mode, Stripe unset).`);
    const u = await api<typeof usage>(`/orgs/${orgId}/usage`);
    setUsage(u);
  }

  async function exportData() {
    if (!orgId) return;
    const data = await api(`/orgs/${orgId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vigilai-export-${orgId}.json`;
    a.click();
  }

  async function deleteOrg() {
    if (!orgId) return;
    if (!confirm("Delete this organization and all data? This cannot be undone.")) {
      return;
    }
    await api(`/orgs/${orgId}`, { method: "DELETE" });
    localStorage.removeItem("vigilai_org");
    window.location.href = "/dashboard";
  }

  return (
    <div>
      <h1>Billing & usage</h1>
      {usage && (
        <>
          <div className="card" style={{ marginTop: "1.25rem" }}>
            <p>
              Current plan: <strong>{usage.plan}</strong>
            </p>
            <p className="muted">
              Limits: {usage.limits.maxHosts} hosts · {usage.limits.retentionDays}d
              retention · {usage.limits.aiSummariesPerMonth} AI summaries/mo
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" onClick={() => upgrade("pro")}>
                Upgrade to Pro
              </button>
              <button type="button" className="secondary" onClick={() => upgrade("business")}>
                Upgrade to Business
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <button type="button" className="secondary" onClick={exportData}>
                Export my data (GDPR)
              </button>
              <button type="button" className="secondary" onClick={deleteOrg}>
                Delete organization
              </button>
              <a className="muted" href="/docs" style={{ alignSelf: "center" }}>
                DPA / legal docs
              </a>
            </div>
            {msg && <p style={{ color: "var(--accent)" }}>{msg}</p>}
          </div>
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Recent usage</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Hosts</th>
                  <th>Alerts</th>
                  <th>AI calls</th>
                </tr>
              </thead>
              <tbody>
                {usage.usage.map((u) => (
                  <tr key={u.day}>
                    <td>{new Date(u.day).toISOString().slice(0, 10)}</td>
                    <td>{u.hostsCounted}</td>
                    <td>{u.alertsFired}</td>
                    <td>{u.aiCalls}</td>
                  </tr>
                ))}
                {usage.usage.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No usage rows yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
