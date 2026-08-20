#!/usr/bin/env bash
set -euo pipefail

TOKEN=""
URL="https://ingest.vigilai.local"
INSTALL_DIR="/opt/vigilai"
BIN_DIR="/usr/local/bin"
VERSION="${VIGILAI_VERSION:-0.2.0}"
RELEASE_BASE="${VIGILAI_RELEASE_BASE:-https://github.com/vigilai/vigilai/releases/download}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_TAG="linux-amd64" ;;
  aarch64|arm64) ARCH_TAG="linux-arm64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Usage: install.sh --token TOKEN [--url INGEST_URL] [--version X.Y.Z]"
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

echo "Installing VigilAI agent ${VERSION} (${ARCH_TAG})..."

mkdir -p "$INSTALL_DIR"
cat > /etc/vigilai-agent.env <<EOF
VIGILAI_TOKEN=${TOKEN}
VIGILAI_INGEST_URL=${URL}
EOF
chmod 600 /etc/vigilai-agent.env

# Prefer prebuilt release tarball; fall back to node if present in INSTALL_DIR
TARBALL="vigilai-agent-${VERSION}-${ARCH_TAG}.tar.gz"
DOWNLOAD_URL="${RELEASE_BASE}/v${VERSION}/${TARBALL}"
if command -v curl >/dev/null 2>&1; then
  if curl -fsSL "$DOWNLOAD_URL" -o "/tmp/${TARBALL}"; then
    tar -xzf "/tmp/${TARBALL}" -C "$INSTALL_DIR"
    ln -sfn "$INSTALL_DIR/vigilai-agent" "$BIN_DIR/vigilai-agent"
  else
    echo "Release download unavailable; expecting node runner at $INSTALL_DIR/vigilai-agent.mjs"
    if ! command -v node >/dev/null 2>&1; then
      echo "Node.js 20+ required when release artifact is missing."
      exit 1
    fi
    cat > "$BIN_DIR/vigilai-agent" <<EOF
#!/usr/bin/env bash
set -a
source /etc/vigilai-agent.env
set +a
exec node "$INSTALL_DIR/vigilai-agent.mjs" "\$@"
EOF
    chmod +x "$BIN_DIR/vigilai-agent"
  fi
fi

cat > /etc/systemd/system/vigilai-agent.service <<EOF
[Unit]
Description=VigilAI monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/vigilai-agent.env
ExecStart=${BIN_DIR}/vigilai-agent
Restart=always
RestartSec=5
User=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now vigilai-agent.service
systemctl --no-pager --full status vigilai-agent.service || true

echo "Done. Agent installed and started via systemd."
