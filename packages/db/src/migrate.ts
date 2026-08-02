import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgresql://vigilai:vigilai@localhost:5432/vigilai";
  const sql = postgres(url, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS drizzle_migrations (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const migrationsDir = join(__dirname, "..", "drizzle");
  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.log("No drizzle folder yet — applying bootstrap SQL");
  }

  if (files.length === 0) {
    const bootstrap = readFileSync(
      join(__dirname, "bootstrap.sql"),
      "utf8",
    );
    await sql.unsafe(bootstrap);
    console.log("Applied bootstrap.sql");
  } else {
    for (const file of files) {
      const existing = await sql`
        SELECT 1 FROM drizzle_migrations WHERE name = ${file}
      `;
      if (existing.length) continue;
      const body = readFileSync(join(migrationsDir, file), "utf8");
      await sql.unsafe(body);
      await sql`INSERT INTO drizzle_migrations (name) VALUES (${file})`;
      console.log(`Applied ${file}`);
    }
  }

  // Ensure Timescale hypertable for metrics when extension is present
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`;
    await sql.unsafe(`
      SELECT create_hypertable('metric_samples', 'time',
        if_not_exists => TRUE,
        migrate_data => TRUE
      );
    `);
    console.log("Timescale hypertable ready");
  } catch (err) {
    console.warn(
      "Timescale hypertable setup skipped/failed (ok for plain Postgres):",
      (err as Error).message,
    );
  }

  await sql.end();
  console.log("Migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
