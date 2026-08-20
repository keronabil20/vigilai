"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<{
        token: string;
        orgs: { id: string }[];
      }>("/auth/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      setToken(res.token);
      if (res.orgs[0]) localStorage.setItem("vigilai_org", res.orgs[0].id);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: "4rem" }}>
      <h1>Log in</h1>
      <form className="card" onSubmit={onSubmit} style={{ marginTop: "1.5rem" }}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required />
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        <Link href="/forgot-password">Forgot password?</Link>
      </p>
      <p className="muted" style={{ marginTop: "1rem" }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </div>
  );
}
