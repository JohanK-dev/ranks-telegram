#!/usr/bin/env bash
# Deploy this project to the minipc and restart the service.
# Usage: ./deploy.sh
set -euo pipefail

REMOTE="johan@192.168.0.2"
REMOTE_DIR="/home/johan/rankstelegram/ranks-telegram"
SERVICE="ranks-scoring"

echo "==> Syncing files to $REMOTE:$REMOTE_DIR"
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'config.js' \
  ./ "$REMOTE:$REMOTE_DIR/"

echo "==> Installing dependencies on remote"
ssh "$REMOTE" "cd '$REMOTE_DIR' && npm install --omit=dev"

echo "==> Restarting $SERVICE"
ssh -t "$REMOTE" "sudo systemctl restart $SERVICE"

echo "==> Recent logs"
ssh "$REMOTE" "sudo journalctl -u $SERVICE -n 20 --no-pager"

echo "==> Deploy complete"
