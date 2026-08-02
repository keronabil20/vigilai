"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Host = {
  id: string;
  name: string;
  hostname: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  computedStatus: string;
};

export default function FleetPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [install, setInstall] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;

  async function load() {
    if (!orgId) return;
    const res = await api<{ hosts: Host[] }>(`/orgs/${orgId}/hosts`);
    setHosts(res.hosts);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [orgId]);

  async function addHost(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    try {
      const res = await api<{
        host: Host;
        installCommand: string;
        token: string;
      }>(`/orgs/${orgId}/hosts`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setInstall(res.installCommand);
      setName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Fleet</h1>
      <p className="muted">Hosts reporting into this organization.</p>

      <form className="card" onSubmit={addHost} style={{ margin: "1.5rem 0" }}>
        <div className="field">
          <label htmlFor="hostName">Add host</label>
          <input
            id="hostName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="production-api"
            required
          />
        </div>
        <button type="submit">Create host + install token</button>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </form>

      {install && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <strong>Install command</strong>
          <p className="muted">Token is shown once. Copy now.</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.3)",
              padding: "1rem",
              borderRadius: 12,
            }}
          >
            {install}
          </pre>
          <p className="muted">
            Dev:{" "}
            <code>
              pnpm --filter @vigilai/agent start -- --token TOKEN --url
              http://localhost:3002
            </code>
          </p>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Hostname</th>
              <th>Agent</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.id}>
                <td>
                  <Link href={`/dashboard/hosts/${h.id}`}>{h.name}</Link>
                </td>
                <td>
                  <span className={`badge ${h.computedStatus}`}>
                    {h.computedStatus}
                  </span>
                </td>
                <td>{h.hostname ?? "—"}</td>
                <td>{h.agentVersion ?? "—"}</td>
                <td>
                  {h.lastSeenAt
                    ? new Date(h.lastSeenAt).toLocaleString()
                    : "never"}
                </td>
              </tr>
            ))}
            {hosts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No hosts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
