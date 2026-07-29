#!/usr/bin/env bash
# Instala Evolution API v2 (Docker + Postgres) en el Droplet. Idempotente.
set -euo pipefail
echo "▶ Instalando Docker (si falta)…"
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
mkdir -p /opt/evolution && cd /opt/evolution

KEY="$(grep -m1 '^AUTHENTICATION_API_KEY=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r"' || true)"
if [ -z "$KEY" ]; then KEY="$(openssl rand -hex 24)"; fi
printf 'AUTHENTICATION_API_KEY=%s\n' "$KEY" > .env

echo "▶ Red y base de datos…"
docker network create evo-net >/dev/null 2>&1 || true
docker volume create evolution_pgdata >/dev/null
docker volume create evolution_instances >/dev/null

docker rm -f evolution-db >/dev/null 2>&1 || true
docker run -d --name evolution-db --restart always --network evo-net \
  -e POSTGRES_USER=evolution \
  -e POSTGRES_PASSWORD=evolution \
  -e POSTGRES_DB=evolution \
  -v evolution_pgdata:/var/lib/postgresql/data \
  postgres:15-alpine

echo "▶ Esperando Postgres…"
for i in $(seq 1 40); do
  docker exec evolution-db pg_isready -U evolution >/dev/null 2>&1 && break
  sleep 2
done

echo "▶ Evolution API…"
docker rm -f evolution-api >/dev/null 2>&1 || true
docker run -d --name evolution-api --restart always --network evo-net -p 8080:8080 \
  -e SERVER_URL="http://$(curl -s ifconfig.me):8080" \
  -e AUTHENTICATION_API_KEY="$KEY" \
  -e DATABASE_ENABLED=true \
  -e DATABASE_PROVIDER=postgresql \
  -e DATABASE_CONNECTION_URI="postgresql://evolution:evolution@evolution-db:5432/evolution?schema=public" \
  -e DATABASE_CONNECTION_CLIENT_NAME=evolution \
  -e DATABASE_SAVE_DATA_INSTANCE=true \
  -e DATABASE_SAVE_DATA_NEW_MESSAGE=false \
  -e DATABASE_SAVE_MESSAGE_UPDATE=false \
  -e DATABASE_SAVE_DATA_CONTACTS=false \
  -e DATABASE_SAVE_DATA_CHATS=false \
  -e DATABASE_SAVE_DATA_LABELS=false \
  -e DATABASE_SAVE_DATA_HISTORIC=false \
  -e CACHE_REDIS_ENABLED=false \
  -e CACHE_LOCAL_ENABLED=true \
  -e DEL_INSTANCE=false \
  -e CONFIG_SESSION_PHONE_CLIENT="Goloso POS" \
  -e CONFIG_SESSION_PHONE_NAME="Chrome" \
  -e QRCODE_LIMIT=30 \
  -v evolution_instances:/evolution/instances \
  evoapicloud/evolution-api:v2.2.3

sleep 20
docker ps -a --filter name=evolution-api --format 'STATUS={{.Status}}'
curl -s -o /dev/null -w "HTTP=%{http_code}\n" http://localhost:8080 || true
echo
echo "✅ Listo."
echo "EVOLUTION_API_URL = http://$(curl -s ifconfig.me):8080"
echo "EVOLUTION_API_KEY = $KEY"
