"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Rule = {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  forMinutes: number;
  severity: string;
  enabled: boolean;
  ruleType?: string;
  zscoreThreshold?: number | null;
};

export default function RulesPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleType, setRuleType] = useState<"threshold" | "anomaly">("threshold");

  async function load() {
    if (!orgId) return;
    const res = await api<{ rules: Rule[] }>(`/orgs/${orgId}/alert-rules`);
    setRules(res.rules);
  }

  useEffect(() => {
    load().catch(console.error);
  }, [orgId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("ruleType") || "threshold") as
      | "threshold"
      | "anomaly";
    await api(`/orgs/${orgId}/alert-rules`, {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        metric: fd.get("metric"),
        operator: fd.get("operator") || ">",
        threshold: Number(fd.get("threshold") || 0),
        forMinutes: Number(fd.get("forMinutes") || 5),
        severity: fd.get("severity"),
        ruleType: type,
        zscoreThreshold: Number(fd.get("zscoreThreshold") || 3),
      }),
    });
    e.currentTarget.reset();
    setRuleType("threshold");
    await load();
  }

  return (
    <div>
      <h1>Alert rules</h1>
      <form className="card" onSubmit={onSubmit} style={{ margin: "1.25rem 0" }}>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>Type</label>
            <select
              name="ruleType"
              value={ruleType}
              onChange={(e) =>
                setRuleType(e.target.value as "threshold" | "anomaly")
              }
            >
              <option value="threshold">threshold</option>
              <option value="anomaly">anomaly (z-score)</option>
            </select>
          </div>
          <div className="field">
            <label>Name</label>
            <input name="name" required />
          </div>
          <div className="field">
            <label>Metric</label>
            <input name="metric" defaultValue="cpu.usage_pct" required />
          </div>
          {ruleType === "threshold" ? (
            <>
              <div className="field">
                <label>Operator</label>
                <select name="operator" defaultValue=">">
                  <option value=">">{">"}</option>
                  <option value=">=">{">="}</option>
                  <option value="<">{"<"}</option>
                  <option value="<=">{"<="}</option>
                </select>
              </div>
              <div className="field">
                <label>Threshold</label>
                <input name="threshold" type="number" defaultValue={90} required />
              </div>
              <div className="field">
                <label>For minutes</label>
                <input name="forMinutes" type="number" defaultValue={5} required />
              </div>
            </>
          ) : (
            <div className="field">
              <label>Z-score threshold</label>
              <input
                name="zscoreThreshold"
                type="number"
                step="0.1"
                defaultValue={3}
                required
              />
            </div>
          )}
          <div className="field">
            <label>Severity</label>
            <select name="severity" defaultValue="warning">
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </div>
        </div>
        <button type="submit">Add rule</button>
      </form>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Condition</th>
              <th>Severity</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.ruleType ?? "threshold"}</td>
                <td>
                  {r.ruleType === "anomaly"
                    ? `${r.metric} z≥${r.zscoreThreshold ?? 3}`
                    : `${r.metric} ${r.operator} ${r.threshold} for ${r.forMinutes}m`}
                </td>
                <td>{r.severity}</td>
                <td>{r.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
