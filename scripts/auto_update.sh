#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="game-deployer.service"
LOG_FILE="/var/log/proxmox-game-deployer-update.log"

{
  echo "=== $(date -Iseconds) - auto update start ==="
  cd "$REPO_DIR"

  echo "[git] pulling latest main..."
  git fetch origin main
  git reset --hard origin/main

  echo "[frontend] building..."
  cd frontend
  npm install --omit=dev=false
  npm run build
  cd ..

  echo "[backend] building..."
  cd backend
  go build -o /usr/local/bin/proxmox-game-deployer ./cmd/server
  cd ..

  echo "[systemd] restarting service ${SERVICE_NAME}..."
  systemctl restart "${SERVICE_NAME}"

  echo "=== $(date -Iseconds) - auto update done ==="
} >>"$LOG_FILE" 2>&1

