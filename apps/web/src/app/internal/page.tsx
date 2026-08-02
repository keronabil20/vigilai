"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function InternalSupportPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [flagsOrg, setFlagsOrg] = useState("");
  const [audit, setAudit] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ events: unknown[] }>("/internal/audit")
      .then((r) => setAudit(r.events))
      .catch((e) => setError(e.message));
  }, [router]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api(`/internal/tenants/search?q=${encodeURIComponent(q)}`);
      setResult(res as Record<string, unknown>);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setFlag(aiEnabled?: boolean, ingestPaused?: boolean) {
    setError(null);
    try {
      await api(`/internal/tenants/${flagsOrg}/flags`, {
        method: "POST",
        body: JSON.stringify({ aiEnabled, ingestPaused }),
      });
      alert("Flags updated");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="container">
      <nav className="nav" style={{ margin: "0 -1.5rem 1.5rem" }}>
        <div className="brand">VigilAI Support</div>
        <a href="/dashboard">Back to app</a>
      </nav>
      <h1>Support console</h1>
      <p className="muted">
        Staff-only. Actions are audited. No remote shell into customer VPS.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <form className="card" onSubmit={search} style={{ marginTop: "1.25rem" }}>
        <div className="field">
          <label>Search email / org / host</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} required />
        </div>
        <button type="submit">Search</button>
      </form>

      {result && (
        <pre
          className="card"
          style={{ marginTop: "1rem", whiteSpace: "pre-wrap", overflow: "auto" }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Feature flags</h3>
        <div className="field">
          <label>Org ID</label>
          <input value={flagsOrg} onChange={(e) => setFlagsOrg(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setFlag(false, undefined)}>
            Disable AI
          </button>
          <button type="button" onClick={() => setFlag(true, undefined)}>
            Enable AI
          </button>
          <button type="button" className="secondary" onClick={() => setFlag(undefined, true)}>
            Pause ingest
          </button>
          <button type="button" className="secondary" onClick={() => setFlag(undefined, false)}>
            Resume ingest
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Recent audit events</h3>
        <pre style={{ whiteSpace: "pre-wrap", overflow: "auto" }}>
          {JSON.stringify(audit, null, 2)}
        </pre>
      </div>
    </div>
  );
}
