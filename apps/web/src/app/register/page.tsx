"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, setToken } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<{
        token: string;
        org: { id: string };
      }>("/auth/register", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          name: fd.get("name"),
          orgName: fd.get("orgName"),
        }),
      });
      setToken(res.token);
      localStorage.setItem("vigilai_org", res.org.id);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: "4rem" }}>
      <h1>Create your VigilAI account</h1>
      <p className="muted">Free tier includes 2 hosts and AI summaries.</p>
      <form className="card" onSubmit={onSubmit} style={{ marginTop: "1.5rem" }}>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" minLength={8} required />
        </div>
        <div className="field">
          <label htmlFor="orgName">Organization</label>
          <input id="orgName" name="orgName" defaultValue="My Organization" required />
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
