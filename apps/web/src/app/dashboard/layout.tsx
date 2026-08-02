"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api, clearToken, getToken } from "@/lib/api";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [isSupport, setIsSupport] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ user: { isSupportStaff: boolean }; orgs: { id: string }[] }>("/auth/me")
      .then((me) => {
        setIsSupport(me.user.isSupportStaff);
        if (!localStorage.getItem("vigilai_org") && me.orgs[0]) {
          localStorage.setItem("vigilai_org", me.orgs[0].id);
        }
        setReady(true);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  if (!ready) {
    return <div className="container">Loading…</div>;
  }

  const links = [
    ["/dashboard", "Fleet"],
    ["/dashboard/alerts", "Alerts"],
    ["/dashboard/rules", "Rules"],
    ["/dashboard/billing", "Billing"],
    ["/dashboard/integrations", "Integrations"],
  ] as const;

  return (
    <>
      <nav className="nav">
        <Link href="/dashboard" className="brand">
          VigilAI
        </Link>
        {links.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            style={{ color: pathname === href ? "var(--ink)" : undefined }}
          >
            {label}
          </Link>
        ))}
        {isSupport && <Link href="/internal">Support</Link>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
        >
          Log out
        </button>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
