"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          token: params.get("token") ?? fd.get("token"),
          password: fd.get("password"),
        }),
      });
      router.push("/login");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: "4rem" }}>
      <h1>Reset password</h1>
      <form className="card" onSubmit={onSubmit}>
        {!params.get("token") && (
          <div className="field">
            <label>Token</label>
            <input name="token" required />
          </div>
        )}
        <div className="field">
          <label>New password</label>
          <input name="password" type="password" minLength={8} required />
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit">Update password</button>
      </form>
    </div>
  );
}
