#!/usr/bin/env bash
set -Eeuo pipefail

# =============================================================
# Goloso WhatsApp Hub - Bootstrap automatico (Baileys multi-sede)
# Idempotente: se puede correr varias veces para actualizar.
# Genera HUB_API_TOKEN aleatorio la primera vez; lo conserva luego.
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

log "1/6 Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates gnupg ufw jq >/dev/null
ok "Paquetes base listos"

log "2/6 Node.js 20 + PM2"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 >/dev/null
ok "Node $(node -v) / pm2 $(pm2 -v)"

log "3/6 Hub en ${HUB_DIR}"
mkdir -p "${HUB_DIR}/sessions"
cd "${HUB_DIR}"

cat > package.json <<'JSON'
{
  "name": "goloso-hub",
  "version": "1.4.0",
  "private": true,
  "type": "commonjs",
  "main": "server.js",
  "dependencies": {
    "@whiskeysockets/baileys": "6.7.24",
    "express": "^4.19.2",
    "pino": "^9.4.0",
    "qrcode": "^1.5.4"
  }
}
JSON

cat > server.js <<'NODE'
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

const PORT = parseInt(process.env.HUB_PORT || '8080', 10);
const TOKEN = process.env.HUB_API_TOKEN || '';
const VERSION = '1.4.0';
const SESSIONS_DIR = path.join(__dirname, 'sessions');

if (!TOKEN) { console.error('HUB_API_TOKEN missing.'); process.exit(1); }
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const logger = pino({ level: 'warn' });
const app = express();
app.use(express.json({ limit: '4mb' }));

// branchId -> { sock, status, qr, phone, lastConnectedAt, lastError, cfg }
// cfg = { deviceToken, posWebhookBase } (persistido en <sessionDir>/hub-config.json)
const branches = new Map();
const startLocks = new Map();

function safeId(id) {
  if (!id || typeof id !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(id)) return null;
  return id;
}

function cfgPath(id) { return path.join(SESSIONS_DIR, id, 'hub-config.json'); }
function loadCfg(id) {
  try { return JSON.parse(fs.readFileSync(cfgPath(id), 'utf8')); } catch { return null; }
}
function saveCfg(id, cfg) {
  try {
    fs.mkdirSync(path.join(SESSIONS_DIR, id), { recursive: true });
    fs.writeFileSync(cfgPath(id), JSON.stringify(cfg));
  } catch (e) { console.error(`[${id}] saveCfg`, e.message); }
}

function state(id) {
  if (!branches.has(id)) {
    branches.set(id, { sock: null, status: 'disconnected', qr: null, phone: null, cfg: loadCfg(id) });
  }
  return branches.get(id);
}

// --- Inbound forwarding hacia POS (Fase 3) ---
async function forwardToPos(id, st, from, text, msgId) {
  if (!st.cfg?.posWebhookBase || !st.cfg?.deviceToken) return;
  const base = String(st.cfg.posWebhookBase).replace(/\/$/, '');
  const url = `${base}/api/public/whatsapp-bot`;
  const token = st.cfg.deviceToken;
  const send = async (action, payload) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, ...payload }),
      });
      const t = await r.text();
      try { return JSON.parse(t); } catch { return { raw: t }; }
    } catch (e) { console.error(`[${id}] forward ${action}`, e.message); return null; }
  };
  const inc = await send('incoming', { from, message: text, msg_id: msgId });
  let reply = inc?.reply && String(inc.reply).trim();
  if ((!reply || inc?.use_ai === true) && text && text.trim()) {
    const ai = await send('ai_reply', { from, text, msg_id: msgId });
    if (ai?.reply) reply = String(ai.reply).trim();
  }
  if (reply && st.sock && st.status === 'connected') {
    const jid = String(from).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    try { await st.sock.sendMessage(jid, { text: reply }); }
    catch (e) { console.error(`[${id}] sendReply`, e.message); }
  }
}

function wipeSession(id) {
  try {
    const dir = path.join(SESSIONS_DIR, id);
    if (!fs.existsSync(dir)) return;
    // preserva hub-config.json (deviceToken/posWebhookBase)
    const cfg = loadCfg(id);
    for (const f of fs.readdirSync(dir)) {
      if (f === 'hub-config.json') continue;
      fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }
    if (cfg) saveCfg(id, cfg);
  } catch (e) { console.error(`[${id}] wipeSession`, e.message); }
}

function stopSock(st) {
  try { st.sock?.end?.(); } catch {}
  try { st.sock?.ws?.close?.(); } catch {}
  st.sock = null;
}

function isBrokenError(msg, code) {
  return code === 515 || /stream errored|restart required|conflict|connection replaced|bad mac|logged out|multidevice|timed out|qr refs attempts ended/i.test(String(msg || ''));
}

async function startBranchLocked(id, opts = {}) {
  const prev = startLocks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => startBranch(id, opts));
  startLocks.set(id, next.finally(() => {
    if (startLocks.get(id) === next) startLocks.delete(id);
  }));
  return next;
}

async function startBranch(id, opts) {
  const st = state(id);
  stopSock(st);
  if (opts && opts.reset) wipeSession(id);
  const dir = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] }));

  const sock = makeWASocket({
    version,
    auth: authState,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    shouldSyncHistoryMessage: () => false,
  });
  st.sock = sock;
  st.status = 'connecting';
  st.qr = null;
  st.lastError = null;
  st.failCount = st.failCount || 0;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      st.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      st.status = 'awaiting_qr';
    }
    if (connection === 'open') {
      st.status = 'connected';
      st.qr = null;
      st.failCount = 0;
      st.phone = sock.user?.id?.split(':')[0]?.split('@')[0] || null;
      st.lastConnectedAt = new Date().toISOString();
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message || '';
      const loggedOut = code === DisconnectReason.loggedOut;
      const streamErr = isBrokenError(msg, code);
      st.lastError = msg || null;
      st.failCount = (st.failCount || 0) + 1;
      if (loggedOut) {
        st.status = 'needs_qr';
        setTimeout(() => startBranchLocked(id, { reset: true }).catch(() => {}), 1500);
      } else if (streamErr || st.failCount >= 3) {
        // corrupt/errored session -> wipe & re-QR
        st.status = 'needs_qr';
        st.failCount = 0;
        setTimeout(() => startBranchLocked(id, { reset: true }).catch(() => {}), 2000);
      } else {
        st.status = 'disconnected';
        setTimeout(() => startBranchLocked(id).catch(() => {}), 3000);
      }
    }
  });
  sock.ev.on('messages.upsert', async (ev) => {
    try {
      if (ev.type !== 'notify') return;
      for (const m of (ev.messages || [])) {
        if (!m.message || m.key?.fromMe) continue;
        const remote = m.key?.remoteJid || '';
        if (!remote.endsWith('@s.whatsapp.net')) continue;
        const from = remote.split('@')[0];
        const msgId = m.key?.id || null;
        const text =
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          m.message.imageMessage?.caption ||
          m.message.videoMessage?.caption ||
          '';
        if (!text || !text.trim()) continue;
        forwardToPos(id, st, from, text.trim(), msgId).catch(() => {});
      }
    } catch (e) { console.error(`[${id}] messages.upsert`, e.message); }
  });
  return st;
}

// --- Auth ---
function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t || t.length !== TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// --- Public ---
app.get('/health', (_req, res) =>
  res.json({ ok: true, version: VERSION, uptime: process.uptime(), branches: branches.size }));

// --- Protected ---
app.get('/api/branch/:id/status', auth, (req, res) => {
  const id = safeId(req.params.id); if (!id) return res.status(400).json({ error: 'bad_id' });
  const st = state(id);
  res.json({
    branchId: id,
    status: st.status,
    qr: st.qr,
    phone: st.phone,
    lastConnectedAt: st.lastConnectedAt || null,
    lastError: st.lastError || null,
  });
});

app.post('/api/branch/:id/connect', auth, async (req, res) => {
  const id = safeId(req.params.id); if (!id) return res.status(400).json({ error: 'bad_id' });
  try {
    const { deviceToken, posWebhookBase, reset } = req.body || {};
    const st = state(id);
    if (deviceToken || posWebhookBase) {
      const cfg = { ...(st.cfg || {}) };
      if (typeof deviceToken === 'string' && deviceToken.length >= 16) cfg.deviceToken = deviceToken;
      if (typeof posWebhookBase === 'string' && /^https?:\/\//.test(posWebhookBase)) cfg.posWebhookBase = posWebhookBase;
      st.cfg = cfg;
      saveCfg(id, cfg);
    }
    // auto-reset if current session is in a broken state
    const broken = st.status === 'needs_qr' || st.status === 'error' || st.status === 'disconnected' ||
      (st.lastError && isBrokenError(st.lastError, null));
    // Para evitar QR inválidos pegados, cualquier nuevo intento fuera de una sesión conectada
    // arranca limpio. Conserva deviceToken/posWebhookBase y solo borra credenciales WhatsApp.
    const doReset = reset !== false || broken;
    st.failCount = 0;
    await startBranchLocked(id, { reset: doReset });
    res.json({ ok: true, status: state(id).status, reset: doReset, hasWebhook: !!(st.cfg?.deviceToken && st.cfg?.posWebhookBase) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/branch/:id/reset', auth, async (req, res) => {
  const id = safeId(req.params.id); if (!id) return res.status(400).json({ error: 'bad_id' });
  try {
    const st = state(id);
    stopSock(st);
    st.failCount = 0; st.lastError = null; st.qr = null; st.phone = null; st.status = 'connecting';
    await startBranchLocked(id, { reset: true });
    res.json({ ok: true, status: state(id).status });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/branch/:id/logout', auth, async (req, res) => {
  const id = safeId(req.params.id); if (!id) return res.status(400).json({ error: 'bad_id' });
  const st = state(id);
  try { if (st.sock) await st.sock.logout(); } catch {}
  stopSock(st);
  try { fs.rmSync(path.join(SESSIONS_DIR, id), { recursive: true, force: true }); } catch {}
  branches.delete(id);
  res.json({ ok: true });
});

app.post('/api/send', auth, async (req, res) => {
  const { branchId, to, text } = req.body || {};
  const id = safeId(branchId);
  if (!id || !to || !text) return res.status(400).json({ error: 'missing fields' });
  const st = state(id);
  if (!st.sock || st.status !== 'connected') return res.status(409).json({ error: 'not_connected' });
  try {
    const jid = String(to).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    await st.sock.sendMessage(jid, { text: String(text) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Autostart branches with existing session on disk
(async () => {
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  for (const id of dirs) {
    startBranchLocked(id).catch((e) => console.error(`[${id}] autostart failed`, e.message));
  }
})();

app.listen(PORT, '0.0.0.0', () => console.log(`Goloso Hub v${VERSION} :${PORT}`));
NODE

log "4/6 Instalando dependencias (2-4 min)"
rm -f package-lock.json
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund
ok "Dependencias listas"

log "5/6 Token y arranque con PM2"
if [[ ! -f "${ENV_FILE}" ]] || ! grep -q '^HUB_API_TOKEN=' "${ENV_FILE}"; then
  TOKEN_VALUE="$(openssl rand -hex 24 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  cat > "${ENV_FILE}" <<EOF
HUB_PORT=${HUB_PORT}
HUB_API_TOKEN=${TOKEN_VALUE}
EOF
  chmod 600 "${ENV_FILE}"
fi
set -a; source "${ENV_FILE}"; set +a

pm2 delete goloso-hub >/dev/null 2>&1 || true
HUB_PORT="${HUB_PORT}" HUB_API_TOKEN="${HUB_API_TOKEN}" \
  pm2 start server.js --name goloso-hub --update-env >/dev/null
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
command -v ufw >/dev/null 2>&1 && ufw allow "${HUB_PORT}"/tcp >/dev/null 2>&1 || true
ok "Hub corriendo"

log "6/6 Verificando"
sleep 3
IP="$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')"
HEALTH="$(curl -sf "http://127.0.0.1:${HUB_PORT}/health" || echo 'FAIL')"
[[ "${HEALTH}" == *'"ok":true'* ]] && ok "Hub responde en http://${IP}:${HUB_PORT}/health" || warn "pm2 logs goloso-hub"

echo ""
echo "================ COPIA ESTOS DOS VALORES ================"
echo "HUB_URL=http://${IP}:${HUB_PORT}"
echo "HUB_API_TOKEN=${HUB_API_TOKEN}"
echo "========================================================="
