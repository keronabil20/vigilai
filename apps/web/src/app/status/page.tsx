"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function StatusPage() {
  const [data, setData] = useState<{
    status: string;
    checks: { database: boolean };
    metrics: { name: string; value: number; time: string }[];
    updatedAt: string;
  } | null>(null);

  useEffect(() => {
    fetch(`${API}/status/public`)
      .then((r) => r.json())
      .then(setData)
      .catch(() =>
        setData({
          status: "unknown",
          checks: { database: false },
          metrics: [],
          updatedAt: new Date().toISOString(),
        }),
      );
    const t = setInterval(() => {
      fetch(`${API}/status/public`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container" style={{ paddingTop: "2rem" }}>
      <Link href="/">← VigilAI</Link>
      <h1>System status</h1>
      {!data ? (
        <p>Loading…</p>
      ) : (
        <>
          <p>
            Overall:{" "}
            <span className={`badge ${data.status === "operational" ? "online" : "critical"}`}>
              {data.status}
            </span>
          </p>
          <div className="card">
            <p>Database: {data.checks.database ? "ok" : "down"}</p>
            <p className="muted">Updated {new Date(data.updatedAt).toLocaleString()}</p>
          </div>
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Platform metrics</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((m, i) => (
                  <tr key={`${m.name}-${i}`}>
                    <td>{m.name}</td>
                    <td>{m.value}</td>
                    <td>{new Date(m.time).toLocaleString()}</td>
                  </tr>
                ))}
                {data.metrics.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No snapshots yet
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
