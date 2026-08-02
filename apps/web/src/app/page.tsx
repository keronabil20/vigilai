import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <nav className="nav">
        <div className="brand">VigilAI</div>
        <Link href="/pricing">Pricing</Link>
        <Link href="/docs">Docs</Link>
        <div style={{ flex: 1 }} />
        <Link href="/login">Log in</Link>
        <Link href="/register">
          <button type="button">Start free</button>
        </Link>
      </nav>
      <section className="hero">
        <div>
          <div className="brand" style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
            VigilAI
          </div>
          <h1>Know what broke on your VPS — in plain English.</h1>
          <p>
            Install one agent. Stream CPU, memory, disk, and network. Get
            threshold alerts plus AI root-cause summaries your team can act on.
          </p>
          <div className="cta-row">
            <Link href="/register">
              <button type="button">Start monitoring</button>
            </Link>
            <Link href="/docs">
              <button type="button" className="secondary">
                Read the docs
              </button>
            </Link>
          </div>
        </div>
        <div className="visual" aria-hidden />
      </section>
    </>
  );
}
