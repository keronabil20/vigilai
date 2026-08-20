"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function MembersPage() {
  const orgId =
    typeof window !== "undefined" ? localStorage.getItem("vigilai_org") : null;
  const [members, setMembers] = useState<
    { membershipId: string; role: string; email: string; name: string | null }[]
  >([]);
  const [invites, setInvites] = useState<
    { id: string; email: string; role: string; expiresAt: string }[]
  >([]);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!orgId) return;
    const res = await api<{
      members: typeof members;
      invites: typeof invites;
    }>(`/orgs/${orgId}/members`);
    setMembers(res.members);
    setInvites(res.invites);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [orgId]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<{ acceptUrl: string }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          role: fd.get("role"),
        }),
      });
      setAcceptUrl(res.acceptUrl);
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Members</h1>
      <p className="muted">Invite teammates. Owner/admin only for invites.</p>
      <form className="card" onSubmit={invite} style={{ margin: "1.25rem 0" }}>
        <div className="field">
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
        <div className="field">
          <label>Role</label>
          <select name="role" defaultValue="member">
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="readonly">readonly</option>
          </select>
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit">Send invite</button>
        {acceptUrl && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Invite link (also emailed/logged): <code>{acceptUrl}</code>
          </p>
        )}
      </form>
      <div className="card">
        <h3>Active</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId}>
                <td>{m.email}</td>
                <td>{m.name ?? "—"}</td>
                <td>{m.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Pending invites</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{i.role}</td>
                <td>{new Date(i.expiresAt).toLocaleString()}</td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  None
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
