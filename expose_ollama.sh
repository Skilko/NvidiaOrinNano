#!/usr/bin/env bash
# expose_ollama.sh — Configure the Ollama service to listen on all interfaces
# ---------------------------------------------------------------------------
# This script creates a systemd drop-in file that sets the environment variable
# OLLAMA_HOST=0.0.0.0 so the Ollama REST API is accessible from other machines
# on the network.
#
# Usage:
#   sudo ./expose_ollama.sh   # must be run as root (or via sudo)
# ---------------------------------------------------------------------------
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Require root privileges -----------------------------------------------
if [[ "$EUID" -ne 0 ]]; then
  err "This script must be run as root (use sudo)"; exit 1
fi

SERVICE_NAME="ollama.service"
DROPIN_DIR="/etc/systemd/system/${SERVICE_NAME}.d"
DROPIN_FILE="${DROPIN_DIR}/bind-all.conf"

log "Creating systemd drop-in directory: ${DROPIN_DIR}"
mkdir -p "${DROPIN_DIR}"

log "Writing override file: ${DROPIN_FILE}"
cat > "${DROPIN_FILE}" <<EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
Environment="OLLAMA_ORIGINS=*"
EOF

log "Reloading systemd daemon"
systemctl daemon-reload

log "Restarting ${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

log "Enabling ${SERVICE_NAME} to start on boot"
systemctl enable "${SERVICE_NAME}"

# Verify ---------------------------------------------------------------
if ss -ltn | grep -q ':11434 '; then
  log "Success! Ollama is now listening on port 11434 for all interfaces."
else
  warn "Ollama does not appear to be listening on :11434. Please check logs."
fi 