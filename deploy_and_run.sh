#!/usr/bin/env bash
# deploy_and_run.sh - Convenience script for Jetson Orin Nano
# -----------------------------------------------------------------------------
#  • Installs missing system dependencies (git, node, npm, python3, pip)
#  • Pulls the latest commits from the 'main' branch of this repo
#  • Installs / updates Python & Node.js dependencies
#  • Builds the React frontend and starts a lightweight static server
#  • Starts the Python system-stats helper
#
#  Frontend: served on http://<JETSON_IP>:3000
#  Backend : http://<JETSON_IP>:5001/api/system-stats
#
#  Run from the repository root:
#      chmod +x deploy_and_run.sh
#      ./deploy_and_run.sh
# -----------------------------------------------------------------------------
set -euo pipefail

# Ensure git trusts this repository even when run as root (systemd service)
if [ -z "${HOME:-}" ]; then
  export HOME=/root
fi
REPO_DIR="/home/bbaorinnano/NvidiaOrinNano"
if ! git config --global --get-all safe.directory | grep -qx "$REPO_DIR"; then
  echo "[INFO] Marking $REPO_DIR as a safe git directory for root user"
  git config --global --add safe.directory "$REPO_DIR"
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "$1 not found. Installing ..."
    sudo apt-get update -qq
    sudo apt-get install -y "$2"
  fi
}

# 1. Ensure core system packages ------------------------------------------------
need_cmd git git
need_cmd python3 python3
need_cmd pip3 python3-pip
need_cmd node nodejs
need_cmd npm npm

# 2. Pull latest code -----------------------------------------------------------
log "Pulling latest code from git"
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" != "main" ]]; then
  warn "You are on branch $current_branch. The script will pull main but not switch branches."
fi

git fetch origin
if ! git merge-base --is-ancestor HEAD origin/main; then
  warn "Local changes detected – performing a fast-forward pull where possible."
fi

git pull --ff-only origin main || {
  err "Fast-forward pull failed. Please resolve git issues manually."; exit 1; }

# 2c. Ensure key scripts have execute permission (in case git resets them)
chmod +x "$REPO_DIR/deploy_and_run.sh"
if [[ -f "$REPO_DIR/expose_ollama.sh" ]]; then
  chmod +x "$REPO_DIR/expose_ollama.sh"
fi

# 2b. Configure / restart Ollama service to listen on all interfaces & allow CORS
if [[ -f "expose_ollama.sh" ]]; then
  log "Configuring Ollama network & CORS settings (requires sudo)"
  if sudo ./expose_ollama.sh; then
    log "Ollama service configured."
  else
    warn "expose_ollama.sh encountered an error. Continuing deployment."
  fi
else
  warn "expose_ollama.sh script not found – skipping Ollama configuration."
fi

# 3. Python dependencies --------------------------------------------------------
if [[ -f requirements.txt ]]; then
  log "Installing Python dependencies"
  # If running as root, --user site-packages are ignored; install system-wide.
  if [[ "$EUID" -eq 0 ]]; then
    pip3 install --break-system-packages -r requirements.txt
  else
    pip3 install --user -r requirements.txt
  fi
fi

# 4. Node/React dependencies ----------------------------------------------------
FRONTEND_DIR="frontend"
if [[ -d "$FRONTEND_DIR" ]]; then
  pushd "$FRONTEND_DIR" >/dev/null
  if [[ ! -d node_modules ]]; then
    log "Installing npm packages (this may take a while)"
    npm install --no-audit --loglevel=error
  else
    log "npm deps already present – running quick update"
    npm ci --no-audit --loglevel=error || npm install --no-audit --loglevel=error
  fi
  log "Building production bundle"
  npm run build --silent
  popd >/dev/null
else
  warn "No ./frontend directory found – skipping React build."
fi

# 5. Start / restart backend ----------------------------------------------------
log "(Re)starting stats_server.py on port 5001"
if pgrep -f stats_server.py >/dev/null; then
  pkill -f stats_server.py
  sleep 1
fi
nohup python3 stats_server.py > stats_server.log 2>&1 &

# 6. Start static server for React build ---------------------------------------
if [[ -d "$FRONTEND_DIR/build" ]]; then
  if ! command -v serve >/dev/null 2>&1; then
    log "Installing 'serve' to serve static React build"
    sudo npm install -g serve
  fi
  log "(Re)starting frontend on port 3000"
  pkill -f "serve -s $FRONTEND_DIR/build" || true
  nohup serve -s "$FRONTEND_DIR/build" -l tcp://0.0.0.0:3000 > frontend.log 2>&1 &
else
  warn "React build directory not found – frontend was not started."
fi

log "All done!"
JETSON_IP=$(hostname -I | awk '{print $1}')
# Announce URLs
echo -e "${GREEN}→ Frontend:${NC} http://$JETSON_IP:3000"
echo -e "${GREEN}→ Backend :${NC} http://$JETSON_IP:5001/api/system-stats"

# If running under systemd (INVOCATION_ID is set), stay alive so the service
# remains active. Otherwise the script exits and systemd marks the unit as
# inactive even though the background servers are still running.
if [[ -n "${INVOCATION_ID:-}" ]]; then
  echo "${GREEN}[INFO]${NC} Running under systemd – keeping process alive."
  # Trap SIGTERM so 'systemctl stop' works cleanly.
  trap 'echo "Stopping background servers"; pkill -f stats_server.py; pkill -f "serve -s"; exit 0' TERM INT
  while :; do sleep 3600; done
fi

# 7. Optionally launch web browser -------------------------------------------
if command -v xdg-open >/dev/null 2>&1; then
  echo -e "${GREEN}[INFO]${NC} Launching default browser with application UI"
  # Use background so script doesn\'t block if browser CLI holds terminal
  (xdg-open "http://$JETSON_IP:3000" >/dev/null 2>&1 &)
elif command -v sensible-browser >/dev/null 2>&1; then
  echo -e "${GREEN}[INFO]${NC} Launching browser via sensible-browser"
  (sensible-browser "http://$JETSON_IP:3000" >/dev/null 2>&1 &)
else
  echo -e "${YELLOW}[WARN]${NC} Could not detect a command to open the browser automatically. Please open http://$JETSON_IP:3000 manually."
fi 