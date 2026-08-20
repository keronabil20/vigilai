"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function IntegrationsPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [rows, setRows] = useState<
    { id: string; type: string; config: { url?: string; email?: string }; enabled: boolean }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!orgId) return;
    const res = await api<{ integrations: typeof rows }>(
      `/orgs/${orgId}/integrations`,
    );
    setRows(res.integrations);
  }

  useEffect(() => {
    load().catch(console.error);
  }, [orgId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("type"));
    try {
      await api(`/orgs/${orgId}/integrations`, {
        method: "POST",
        body: JSON.stringify({
          type,
          config:
            type === "email"
              ? { email: fd.get("value") }
              : { url: fd.get("value") },
        }),
      });
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function startSlack() {
    if (!orgId) return;
    try {
      const res = await api<{ url: string }>(
        `/orgs/${orgId}/integrations/slack/start`,
      );
      window.location.href = res.url;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Integrations</h1>
      <p className="muted">
        Webhook URLs to private/metadata IPs are blocked (SSRF protection).
      </p>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <button type="button" onClick={startSlack}>
          Connect Slack (OAuth)
        </button>
      </div>
      <form className="card" onSubmit={onSubmit} style={{ margin: "1.25rem 0" }}>
        <div className="field">
          <label>Type</label>
          <select name="type" defaultValue="webhook">
            <option value="webhook">webhook</option>
            <option value="slack">slack</option>
            <option value="email">email</option>
          </select>
        </div>
        <div className="field">
          <label>URL or email</label>
          <input name="value" required placeholder="https://hooks.example.com/..." />
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit">Add</button>
      </form>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Target</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.type}</td>
                <td>{r.config.url ?? r.config.email}</td>
                <td>{r.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
