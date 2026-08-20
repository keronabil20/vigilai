#!/bin/sh
set -e
cd /app
echo "Running DB migrations..."
node packages/db/dist/migrate.js
echo "Starting API..."
exec node apps/api/dist/index.js
