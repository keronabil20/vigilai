"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";

function AcceptInviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Missing token");
      return;
    }
    if (!getToken()) {
      router.replace(`/login?next=/accept-invite?token=${token}`);
      return;
    }
    api<{ orgId: string }>("/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        localStorage.setItem("vigilai_org", res.orgId);
        router.replace("/dashboard");
      })
      .catch((e) => setError(e.message));
  }, [params, router]);

  return (
    <div className="container" style={{ paddingTop: "4rem" }}>
      <h1>Accepting invite…</h1>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: "4rem" }}>
          <h1>Accepting invite…</h1>
        </div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
