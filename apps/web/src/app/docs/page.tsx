import Link from "next/link";

export default function DocsPage() {
  return (
    <div className="container" style={{ paddingTop: "2rem", maxWidth: 760 }}>
      <Link href="/">← VigilAI</Link>
      <h1>Documentation</h1>
      <h2>Quick start</h2>
      <ol>
        <li>Register and create a host in the dashboard.</li>
        <li>Copy the install command (or run the agent with the token).</li>
        <li>Metrics appear within about a minute.</li>
        <li>Default rules alert on high CPU, memory, and disk.</li>
      </ol>
      <h2>Agent (dev)</h2>
      <pre className="card">{`pnpm --filter @vigilai/agent start -- --token TOKEN --url http://localhost:3002`}</pre>
      <h2>Support runbooks</h2>
      <p>
        See the repository <code>docs/support/</code> folder for agent offline,
        missing metrics, alert noise, AI, billing, abuse, GDPR, and platform
        incident playbooks.
      </p>
      <h2>API</h2>
      <p>
        Control plane defaults to <code>http://localhost:3001</code>. Ingest is{" "}
        <code>http://localhost:3002</code>. OpenAPI-style route list is in{" "}
        <code>docs/api/README.md</code>.
      </p>
    </div>
  );
}
