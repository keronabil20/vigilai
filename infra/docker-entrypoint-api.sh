#!/bin/sh
set -e
cd /app
echo "Running DB migrations..."
pnpm --filter @vigilai/db migrate || node --import tsx packages/db/src/migrate.ts || node -e "
const { spawnSync } = require('child_process');
const r = spawnSync('npx', ['tsx', 'packages/db/src/migrate.ts'], { stdio: 'inherit', shell: true });
process.exit(r.status || 0);
"
echo "Starting API..."
exec node apps/api/dist/index.js
