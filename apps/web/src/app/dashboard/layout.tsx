"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api, clearToken, getToken } from "@/lib/api";

type Org = { id: string; name: string; plan: string; role: string };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [isSupport, setIsSupport] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [role, setRole] = useState<string>("member");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{
      user: { isSupportStaff: boolean };
      orgs: Org[];
    }>("/auth/me")
      .then((me) => {
        setIsSupport(me.user.isSupportStaff);
        setOrgs(me.orgs);
        let current = localStorage.getItem("vigilai_org") ?? "";
        if (!current && me.orgs[0]) current = me.orgs[0].id;
        if (current) localStorage.setItem("vigilai_org", current);
        setOrgId(current);
        const match = me.orgs.find((o) => o.id === current);
        setRole(match?.role ?? "member");
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
    ["/dashboard/members", "Members"],
    ["/dashboard/hostinger", "Hostinger"],
    ["/dashboard/billing", "Billing"],
    ["/dashboard/integrations", "Integrations"],
  ] as const;

  const readonly = role === "readonly";

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
        <select
          value={orgId}
          onChange={(e) => {
            localStorage.setItem("vigilai_org", e.target.value);
            setOrgId(e.target.value);
            const match = orgs.find((o) => o.id === e.target.value);
            setRole(match?.role ?? "member");
            router.refresh();
            window.location.reload();
          }}
          style={{ maxWidth: 180 }}
          aria-label="Organization"
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.role})
            </option>
          ))}
        </select>
        {readonly && <span className="badge pending">readonly</span>}
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
