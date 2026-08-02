#!/usr/bin/env bash
set -euo pipefail

TOKEN=""
URL="https://ingest.vigilai.local"
INSTALL_DIR="/usr/local/bin"
VERSION="0.1.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Usage: install.sh --token TOKEN [--url INGEST_URL]"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node then re-run."
  exit 1
fi

echo "Installing VigilAI agent ${VERSION}..."

# Prefer npm package from registry in production; for local/dev use npx tsx path or copy.
cat > /etc/vigilai-agent.env <<EOF
VIGILAI_TOKEN=${TOKEN}
VIGILAI_INGEST_URL=${URL}
EOF
chmod 600 /etc/vigilai-agent.env

# Create a thin runner that expects the agent package to be available
cat > "${INSTALL_DIR}/vigilai-agent" <<'EOF'
#!/usr/bin/env bash
set -a
source /etc/vigilai-agent.env
set +a
exec node "$(dirname "$0")/vigilai-agent.mjs" "$@"
EOF
chmod +x "${INSTALL_DIR}/vigilai-agent"

echo "Agent binary placeholder installed. For development, run:"
echo "  pnpm --filter @vigilai/agent start -- --token \$TOKEN --url \$URL"
echo ""
echo "Systemd unit example written to /tmp/vigilai-agent.service"
cat > /tmp/vigilai-agent.service <<EOF
[Unit]
Description=VigilAI monitoring agent
After=network-online.target

[Service]
EnvironmentFile=/etc/vigilai-agent.env
ExecStart=${INSTALL_DIR}/vigilai-agent
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

echo "Done. Token saved to /etc/vigilai-agent.env"
