#!/usr/bin/env bash
set -euo pipefail

APP_USER="proxmox"
APP_GROUP="proxmox"
APP_DIR="/opt/proxmox-game-deployer"
SERVICE_NAME="game-deployer.service"
UPDATE_SERVICE_NAME="game-deployer-update.service"
TIMER_NAME="game-deployer-update.timer"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$EUID" -ne 0 ]]; then
  echo "This installer must be run as root (sudo)."
  exit 1
fi

echo "==> Installing Proxmox Game Deployer"
echo "    Source repo: $REPO_DIR"
echo "    Target dir : $APP_DIR"

mkdir -p "$APP_DIR"

echo "==> Copying files to $APP_DIR..."
rsync -a --delete "$REPO_DIR"/ "$APP_DIR"/

echo "==> Ensuring system user/group $APP_USER..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER"
fi

echo "==> Setting ownership..."
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR" || chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Installing pgdctl to /usr/local/bin..."
install -m 0755 "$APP_DIR/scripts/pgdctl" /usr/local/bin/pgdctl

echo "==> Installing systemd units..."
install -m 0644 "$APP_DIR/deploy/systemd/game-deployer.service" /etc/systemd/system/game-deployer.service
install -m 0644 "$APP_DIR/deploy/systemd/game-deployer-update.service" /etc/systemd/system/game-deployer-update.service
install -m 0644 "$APP_DIR/deploy/systemd/game-deployer-update.timer" /etc/systemd/system/game-deployer-update.timer

echo "==> Building initial binary..."
cd "$APP_DIR"
mkdir -p data
chown -R "$APP_USER:$APP_GROUP" data || chown -R "$APP_USER:$APP_USER" data

cd frontend
npm install
npm run build

cd "$APP_DIR/backend"
go build -o /usr/local/bin/proxmox-game-deployer ./cmd/server

echo "==> Reloading systemd and enabling services..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" "$TIMER_NAME"
systemctl restart "$SERVICE_NAME"
systemctl start "$TIMER_NAME"

echo ""
echo "Installation completed."
echo "Service status:"
systemctl status "$SERVICE_NAME" --no-pager || true
echo ""
echo "You can now use:"
echo "  pgdctl status   # show service status"
echo "  pgdctl update   # pull + build + restart with logs"
echo ""

