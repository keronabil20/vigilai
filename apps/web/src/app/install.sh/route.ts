import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function GET() {
  const path = join(process.cwd(), "../../agent/install.sh");
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body = `#!/usr/bin/env bash
echo "Install script not found in this deployment. Use: pnpm --filter @vigilai/agent start -- --token TOKEN --url INGEST_URL"
`;
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
