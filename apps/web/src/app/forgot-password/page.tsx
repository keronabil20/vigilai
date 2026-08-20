"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: fd.get("email") }),
    });
    setMsg(res.message);
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: "4rem" }}>
      <h1>Forgot password</h1>
      <form className="card" onSubmit={onSubmit}>
        <div className="field">
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
        <button type="submit">Send reset link</button>
        {msg && <p className="muted">{msg}</p>}
      </form>
      <p className="muted">
        <Link href="/login">Back to login</Link>
      </p>
    </div>
  );
}
