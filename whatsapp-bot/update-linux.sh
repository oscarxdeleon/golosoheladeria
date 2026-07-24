#!/usr/bin/env bash
set -Eeuo pipefail

BOT_VERSION="8.10.0"
CANONICAL_API_URL="https://golosoheladeria.lovable.app"
DOWNLOAD_URL="${GOLOSO_BOT_ZIP_URL:-https://golosoheladeria.lovable.app/downloads/whatsapp-bot.zip}"
TARGET_DIR="${1:-$(pwd)}"
PM2_NAME="${2:-${PM2_NAME:-}}"

if [[ -z "${TARGET_DIR}" ]]; then
  echo "[ERROR] Debes indicar la carpeta del bot. Ejemplo: bash update-linux.sh /opt/goloso/sede2 goloso-parque" >&2
  exit 1
fi

if [[ -z "${PM2_NAME}" ]]; then
  base="$(basename "${TARGET_DIR}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${base}" == *"sede2"* || "${base}" == *"parque"* ]]; then
    PM2_NAME="goloso-parque"
  else
    PM2_NAME="goloso-bot"
  fi
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Falta instalar '$1' en este servidor." >&2
    exit 1
  fi
}

need_cmd node
need_cmd npm
need_cmd pm2
need_cmd curl
need_cmd unzip

TARGET_DIR="$(mkdir -p "${TARGET_DIR}" && cd "${TARGET_DIR}" && pwd)"
echo ""
echo "🍨 Goloso WhatsApp Bot — actualización Ubuntu/PM2"
echo "   Versión objetivo : ${BOT_VERSION}"
echo "   Carpeta objetivo : ${TARGET_DIR}"
echo "   Proceso PM2      : ${PM2_NAME}"
echo "   ZIP              : ${DOWNLOAD_URL}"

if [[ ! -f "${TARGET_DIR}/config.json" ]]; then
  echo "[ERROR] No existe config.json en ${TARGET_DIR}. Esa no parece ser la carpeta activa del bot." >&2
  echo "        Revisa con: pm2 describe ${PM2_NAME}" >&2
  exit 2
fi

backup_dir="${TARGET_DIR}/backup-before-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${backup_dir}"
cp -f "${TARGET_DIR}/config.json" "${backup_dir}/config.json"
if [[ -d "${TARGET_DIR}/auth_state" ]]; then
  cp -a "${TARGET_DIR}/auth_state" "${backup_dir}/auth_state"
fi

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "${tmp_dir}"; }
trap cleanup EXIT

echo ""
echo "== Descargando paquete actualizado =="
curl -fL --retry 3 --retry-delay 2 "${DOWNLOAD_URL}" -o "${tmp_dir}/whatsapp-bot.zip"
unzip -qo "${tmp_dir}/whatsapp-bot.zip" -d "${tmp_dir}/pkg"

if [[ ! -f "${tmp_dir}/pkg/server.js" ]]; then
  echo "[ERROR] El ZIP descargado no contiene server.js." >&2
  exit 3
fi

downloaded_version="$(grep -Eo 'BOT_VERSION = "[^"]+"' "${tmp_dir}/pkg/server.js" | head -n1 | sed -E 's/.*"([^"]+)"/\1/')"
if [[ "${downloaded_version}" != "${BOT_VERSION}" ]]; then
  echo "[ERROR] El paquete descargado trae versión ${downloaded_version:-desconocida}, se esperaba ${BOT_VERSION}." >&2
  echo "        Puede faltar publicar la app o el CDN aún está sirviendo una versión vieja." >&2
  exit 4
fi

echo ""
echo "== Deteniendo proceso anterior =="
pm2 stop "${PM2_NAME}" >/dev/null 2>&1 || true

echo ""
echo "== Copiando archivos sin tocar config.json ni auth_state =="
for file in \
  server.js \
  setup.js \
  package.json \
  package-lock.json \
  README.md \
  update-linux.sh \
  start-hidden.vbs \
  install-windows.bat \
  update-windows.bat \
  update-windows.ps1 \
  ACTUALIZAR-SIN-QR.bat \
  SOLUCION-SIN-SABER-CARPETA.bat \
  uninstall-windows.bat
do
  if [[ -f "${tmp_dir}/pkg/${file}" ]]; then
    cp -f "${tmp_dir}/pkg/${file}" "${TARGET_DIR}/${file}"
  fi
done
chmod +x "${TARGET_DIR}/update-linux.sh" || true

echo ""
echo "== Corrigiendo API POS a dominio con Gemini directo =="
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const cfgPath = path.join(process.cwd(), 'config.json');
const canonical = process.env.GOLOSO_CANONICAL_API_URL || 'https://golosoheladeria.lovable.app';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.apiUrl = canonical;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`apiUrl=${canonical}`);
NODE

echo ""
echo "== Instalando dependencias =="
cd "${TARGET_DIR}"
npm install --omit=dev --no-audit --no-fund
node --check server.js

if ! grep -q "BOT_VERSION = \"${BOT_VERSION}\"" "${TARGET_DIR}/server.js"; then
  echo "[ERROR] server.js no quedó en versión ${BOT_VERSION}." >&2
  exit 5
fi

echo ""
echo "== Reiniciando PM2 desde la carpeta correcta =="
pm2 delete "${PM2_NAME}" >/dev/null 2>&1 || true
pm2 start "${TARGET_DIR}/server.js" --name "${PM2_NAME}" --cwd "${TARGET_DIR}" --update-env
pm2 save >/dev/null 2>&1 || true

echo ""
echo "== Verificación =="
sleep 2
pm2 logs "${PM2_NAME}" --lines 25 --nostream || true

status_json=""
for port in 8791 8790 8792 8793; do
  if status_json="$(curl -fsS "http://localhost:${port}/status.json" 2>/dev/null)"; then
    echo ""
    echo "Panel local: http://localhost:${port}/status.json"
    echo "${status_json}"
    break
  fi
done

echo ""
echo "✅ Actualización completa. Debe verse: Versión : ${BOT_VERSION}"
echo "   Si PM2 vuelve a mostrar una versión vieja, ejecuta: pm2 describe ${PM2_NAME}"