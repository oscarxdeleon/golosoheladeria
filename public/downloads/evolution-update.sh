#!/usr/bin/env bash
# Actualiza Evolution API a la última versión y arregla el problema de "no aparece el QR".
# Conserva la API key, la base de datos y las sesiones ya vinculadas. Idempotente.
set -euo pipefail

cd /opt/evolution 2>/dev/null || { mkdir -p /opt/evolution && cd /opt/evolution; }

KEY="$(grep -m1 '^AUTHENTICATION_API_KEY=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r"' || true)"
if [ -z "$KEY" ]; then
  KEY="$(docker inspect evolution-api --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -m1 '^AUTHENTICATION_API_KEY=' | cut -d= -f2- || true)"
fi
if [ -z "$KEY" ]; then echo "❌ No encontré la API key. Ejecuta primero evolution-bootstrap.sh"; exit 1; fi
printf 'AUTHENTICATION_API_KEY=%s\n' "$KEY" > .env

IMAGE="${EVOLUTION_IMAGE:-evoapicloud/evolution-api:latest}"
# Versión de WhatsApp Web que Baileys debe anunciar. Si WhatsApp cambia y deja
# de salir el QR, actualiza este valor.
WA_VERSION="${WA_VERSION:-2.3000.1028066197}"

echo "▶ Descargando $IMAGE…"
docker pull "$IMAGE"

echo "▶ Asegurando base de datos…"
docker network create evo-net >/dev/null 2>&1 || true
docker volume create evolution_pgdata >/dev/null
docker volume create evolution_instances >/dev/null
if ! docker ps --format '{{.Names}}' | grep -q '^evolution-db$'; then
  docker rm -f evolution-db >/dev/null 2>&1 || true
  docker run -d --name evolution-db --restart always --network evo-net \
    -e POSTGRES_USER=evolution -e POSTGRES_PASSWORD=evolution -e POSTGRES_DB=evolution \
    -v evolution_pgdata:/var/lib/postgresql/data postgres:15-alpine
  for i in $(seq 1 40); do docker exec evolution-db pg_isready -U evolution >/dev/null 2>&1 && break; sleep 2; done
fi

echo "▶ Reemplazando el contenedor de Evolution API…"
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
  -e QRCODE_LIMIT=60 \
  -e QRCODE_COLOR="#198754" \
  -e CONFIG_SESSION_PHONE_CLIENT="Goloso POS" \
  -e CONFIG_SESSION_PHONE_NAME="Chrome" \
  -e CONFIG_SESSION_PHONE_VERSION="$WA_VERSION" \
  -e LOG_LEVEL="ERROR,WARN,INFO" \
  -e LOG_BAILEYS="error" \
  -v evolution_instances:/evolution/instances \
  "$IMAGE"

echo "▶ Esperando a que arranque…"
for i in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:8080" && break
  sleep 2
done

echo
docker ps --filter name=evolution-api --format 'CONTENEDOR: {{.Status}} ({{.Image}})'
curl -s http://localhost:8080 | head -c 200; echo
echo
echo "✅ Actualizado."
echo "EVOLUTION_API_URL = http://$(curl -s ifconfig.me):8080"
echo "EVOLUTION_API_KEY = $KEY"
echo
echo "Ahora en el POS: Ajustes → WhatsApp Bot → Eliminar instancia → Generar nuevo QR."
