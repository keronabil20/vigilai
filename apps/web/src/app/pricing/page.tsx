import Link from "next/link";

export default function PricingPage() {
  return (
    <div className="container" style={{ paddingTop: "2rem" }}>
      <Link href="/">← VigilAI</Link>
      <h1>Pricing</h1>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: "1.5rem" }}>
        {[
          ["Free", "2 hosts", "14d retention", "10 AI summaries/mo", "Email"],
          ["Pro", "25 hosts", "30d retention", "200 AI summaries/mo", "Email + Slack/webhook"],
          ["Business", "100 hosts", "90d retention", "1000 AI summaries/mo", "Priority support"],
        ].map(([name, ...rows]) => (
          <div className="card" key={name}>
            <h2>{name}</h2>
            <ul>
              {rows.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Link href="/register">
              <button type="button">Get started</button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
