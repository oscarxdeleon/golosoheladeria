#!/usr/bin/env bash
set -Eeuo pipefail

# =============================================================
# Goloso WhatsApp Hub - Bootstrap automatico
# Instala Node 20, PM2, Baileys y arranca el Hub en el puerto 8080.
# Genera HUB_API_TOKEN aleatorio y lo imprime al final.
# Idempotente: se puede correr varias veces sin romper nada.
# =============================================================

HUB_DIR="/opt/goloso-hub"
HUB_PORT="${HUB_PORT:-8080}"
ENV_FILE="${HUB_DIR}/.env"

log() { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()  { echo -e "\033[1;32m✔ $*\033[0m"; }
warn(){ echo -e "\033[1;33m! $*\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "Este script debe ejecutarse como root." >&2
  exit 1
fi

log "1/7 Actualizando paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates gnupg ufw jq >/dev/null
ok "Paquetes base listos"

log "2/7 Instalando Node.js 20"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
ok "Node $(node -v) / npm $(npm -v)"

log "3/7 Instalando PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 >/dev/null
fi
ok "PM2 $(pm2 -v)"

log "4/7 Preparando carpeta del Hub en ${HUB_DIR}"
mkdir -p "${HUB_DIR}"
cd "${HUB_DIR}"

if [[ ! -f package.json ]]; then
  cat > package.json <<'JSON'
{
  "name": "goloso-hub",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "server.js",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.9",
    "express": "^4.19.2",
    "pino": "^9.4.0",
    "qrcode": "^1.5.4"
  }
}
JSON
fi

# ---- server.js (Hub minimal listo para extender) ----
cat > server.js <<'NODE'
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.HUB_PORT || '8080', 10);
const TOKEN = process.env.HUB_API_TOKEN || '';
const VERSION = '1.0.0';

if (!TOKEN) {
  console.error('HUB_API_TOKEN missing. Refusing to start.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// Public health (no auth)
app.get('/health', (_req, res) => {
  res.json({ ok: true, version: VERSION, uptime: process.uptime() });
});

// Auth middleware
function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t || t.length !== TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Placeholder endpoints - se extienden en Fase 2 con Baileys real
const sessions = new Map(); // branchId -> { status, qr, phone, updatedAt }

app.get('/api/status', auth, (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    branches: Array.from(sessions.entries()).map(([id, s]) => ({ id, ...s })),
  });
});

app.get('/api/branch/:id/status', auth, (req, res) => {
  const s = sessions.get(req.params.id) || { status: 'disconnected' };
  res.json(s);
});

app.post('/api/branch/:id/connect', auth, (req, res) => {
  const id = req.params.id;
  sessions.set(id, { status: 'awaiting_qr', qr: null, updatedAt: Date.now() });
  res.json({ ok: true, status: 'awaiting_qr' });
});

app.post('/api/branch/:id/logout', auth, (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/send', auth, (req, res) => {
  const { branchId, to, text } = req.body || {};
  if (!branchId || !to || !text) return res.status(400).json({ error: 'missing fields' });
  console.log(`[send] ${branchId} -> ${to}: ${text.slice(0, 80)}`);
  res.json({ ok: true, queued: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Goloso Hub v${VERSION} listening on :${PORT}`);
});
NODE

log "5/7 Instalando dependencias npm (puede tardar 1-2 min)"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund
ok "Dependencias instaladas"

log "6/7 Configurando token y arranque con PM2"
if [[ ! -f "${ENV_FILE}" ]] || ! grep -q '^HUB_API_TOKEN=' "${ENV_FILE}"; then
  TOKEN_VALUE="$(openssl rand -hex 24 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  cat > "${ENV_FILE}" <<EOF
HUB_PORT=${HUB_PORT}
HUB_API_TOKEN=${TOKEN_VALUE}
EOF
  chmod 600 "${ENV_FILE}"
fi

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

pm2 delete goloso-hub >/dev/null 2>&1 || true
HUB_PORT="${HUB_PORT}" HUB_API_TOKEN="${HUB_API_TOKEN}" \
  pm2 start server.js --name goloso-hub --update-env >/dev/null

pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# Firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${HUB_PORT}"/tcp >/dev/null 2>&1 || true
fi
ok "Hub arrancado con PM2"

log "7/7 Verificando"
sleep 2
IP="$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')"
HEALTH="$(curl -sf "http://127.0.0.1:${HUB_PORT}/health" || echo 'FAIL')"
if [[ "${HEALTH}" == *'"ok":true'* ]]; then
  ok "Hub responde en http://${IP}:${HUB_PORT}/health"
else
  warn "El Hub no respondio localmente. Revisa: pm2 logs goloso-hub"
fi

echo ""
echo "================ COPIA ESTOS DOS VALORES ================"
echo "HUB_URL=http://${IP}:${HUB_PORT}"
echo "HUB_API_TOKEN=${HUB_API_TOKEN}"
echo "========================================================="
echo ""
echo "Pegalos en el chat del POS para continuar la configuracion."
