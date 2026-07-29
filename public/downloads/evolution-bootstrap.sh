#!/usr/bin/env bash
# Instala Evolution API v2 (Docker) en el Droplet. Idempotente.
set -euo pipefail
echo "▶ Instalando Docker (si falta)…"
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
mkdir -p /opt/evolution && cd /opt/evolution
if [ -f .env ]; then . ./.env; fi
KEY="${AUTHENTICATION_API_KEY:-$(openssl rand -hex 24)}"
cat > .env <<ENV
AUTHENTICATION_API_KEY=$KEY
ENV
docker rm -f evolution-api >/dev/null 2>&1 || true
docker volume create evolution_instances >/dev/null
docker run -d --name evolution-api --restart always -p 8080:8080 \
  -e AUTHENTICATION_API_KEY="$KEY" \
  -e DEL_INSTANCE=false \
  -e CONFIG_SESSION_PHONE_CLIENT="Goloso POS" \
  -e CONFIG_SESSION_PHONE_NAME="Chrome" \
  -e QRCODE_LIMIT=30 \
  -v evolution_instances:/evolution/instances \
  atendai/evolution-api:v2.1.1
echo
echo "✅ Listo."
echo "EVOLUTION_API_URL = http://$(curl -s ifconfig.me):8080"
echo "EVOLUTION_API_KEY = $KEY"
