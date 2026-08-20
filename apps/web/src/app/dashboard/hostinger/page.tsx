"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function HostingerPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [vms, setVms] = useState<{ id: string; hostname?: string; plan?: string }[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [install, setInstall] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/orgs/${orgId}/hostinger/connect`, {
        method: "POST",
        body: JSON.stringify({ apiToken: fd.get("apiToken") }),
      });
      const list = await api<{
        vms: unknown;
        demo?: { id: string; hostname?: string; plan?: string }[];
        warning?: string;
      }>(`/orgs/${orgId}/hostinger/vms`);
      setWarning(list.warning ?? null);
      const rows = Array.isArray(list.vms) && list.vms.length
        ? (list.vms as { id: string; hostname?: string; plan?: string }[])
        : list.demo ?? [];
      setVms(rows);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function importVm(name: string, hostname?: string) {
    if (!orgId) return;
    const res = await api<{ installCommand: string }>(
      `/orgs/${orgId}/hostinger/import`,
      {
        method: "POST",
        body: JSON.stringify({ name, hostname }),
      },
    );
    setInstall(res.installCommand);
  }

  useEffect(() => {
    if (!orgId) return;
    api<{
      vms: unknown;
      demo?: { id: string; hostname?: string; plan?: string }[];
      warning?: string;
    }>(`/orgs/${orgId}/hostinger/vms`)
      .then((list) => {
        setWarning(list.warning ?? null);
        const rows = Array.isArray(list.vms) && list.vms.length
          ? (list.vms as { id: string; hostname?: string; plan?: string }[])
          : list.demo ?? [];
        setVms(rows);
      })
      .catch(() => {});
  }, [orgId]);

  return (
    <div>
      <h1>Hostinger connect</h1>
      <p className="muted">
        Store an API token, list VMs, create a VigilAI host, then run the agent
        install on the VPS (no remote exec).
      </p>
      <form className="card" onSubmit={connect} style={{ margin: "1.25rem 0" }}>
        <div className="field">
          <label>Hostinger API token</label>
          <input name="apiToken" required />
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit">Connect</button>
      </form>
      {warning && <p className="muted">{warning}</p>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Hostname</th>
              <th>Plan</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vms.map((v) => (
              <tr key={v.id}>
                <td>{v.id}</td>
                <td>{v.hostname ?? "—"}</td>
                <td>{v.plan ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      importVm(v.hostname ?? v.id, v.hostname)
                    }
                  >
                    Import
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {install && (
        <pre className="card" style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>
          {install}
        </pre>
      )}
    </div>
  );
}
