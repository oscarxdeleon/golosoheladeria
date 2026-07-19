/**
 * Goloso — Bot local de WhatsApp.
 *
 * Corre en el PC de cada sede. Usa Baileys (WhatsApp Web protocol) para
 * conectarse al número de la sede escaneando un QR una sola vez.
 * Toda la lógica de "qué responder" vive en el POS: este bot solo:
 *   1. Reporta estado al POS cada 30s (heartbeat + QR cuando aplique).
 *   2. Cuando llega un mensaje entrante, lo envía al POS y responde con
 *      lo que el POS le indique.
 *
 * Config: `config.json` con { token, apiUrl }. Se crea con `setup.js`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import QRCode from "qrcode";
import pino from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const AUTH_DIR = path.join(__dirname, "auth_state");
const LOCAL_PORT = 8790;
const HEARTBEAT_MS = 30_000;
const OUTBOUND_POLL_MS = 20_000;
const REPLY_DELAY_MIN = 2000;
const REPLY_DELAY_MAX = 5000;
const OUTBOUND_DELAY_MIN = 1500;
const OUTBOUND_DELAY_MAX = 3500;
const VERSION_FETCH_TIMEOUT_MS = 7_000;

const logger = pino({ level: "info" }, pino.destination({ dest: path.join(__dirname, "bot.log"), sync: false }));

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("\nNo hay config.json. Ejecuta primero: node setup.js\n");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  if (!raw.token || !raw.apiUrl) {
    console.error("config.json inválido: faltan token o apiUrl.");
    process.exit(1);
  }
  return raw;
}

const config = loadConfig();

let state = {
  status: "connecting",     // connecting | qr | connected | disconnected | error
  qr: null,                  // string cuando status === "qr"
  qrDataUrl: null,           // dataURL para servir en localhost
  phone: null,
  lastError: null,
  lastPushError: null,
  lastPushAt: null,
  detail: "Iniciando conexión con WhatsApp...",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function pushStatus() {
  try {
    const body = {
      action: "status",
      token: config.token,
      status: state.status,
      qr: state.qr,
      phone: state.phone,
    };
    const res = await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      state.lastPushError = `POS respondió ${res.status}: ${txt.slice(0, 250)}`;
      logger.warn({ status: res.status, body: txt }, "status push failed");
    } else {
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt.slice(0, 250) }; }
      if (data?.error) {
        state.lastPushError = `POS rechazó estado: ${data.error}`;
        logger.warn({ body: data }, "status push rejected");
        return;
      }
      state.lastPushError = null;
      state.lastPushAt = Date.now();
    }
  } catch (e) {
    state.lastPushError = String(e);
    logger.warn({ err: String(e) }, "status push error");
  }
}

async function handleIncoming(from, body) {
  try {
    const res = await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "incoming", token: config.token, from, message: body }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "incoming push failed");
      return null;
    }
    const data = await res.json();
    return data.reply || null;
  } catch (e) {
    logger.warn({ err: String(e) }, "incoming error");
    return null;
  }
}

function humanDelay() {
  return Math.floor(REPLY_DELAY_MIN + Math.random() * (REPLY_DELAY_MAX - REPLY_DELAY_MIN));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} tardó más de ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getSafeBaileysVersion() {
  try {
    const { version } = await withTimeout(fetchLatestBaileysVersion(), VERSION_FETCH_TIMEOUT_MS, "La consulta de versión de WhatsApp");
    logger.info({ version }, "using latest WhatsApp Web version");
    return version;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "could not fetch latest WhatsApp Web version; using bundled Baileys version");
    state.lastError = `${message}. Se continúa con la versión incluida en el bot.`;
    return undefined;
  }
}

async function startSocket() {
  state.status = "connecting";
  state.detail = "Preparando sesión de WhatsApp...";
  console.log("\nConectando con WhatsApp. El QR puede tardar unos segundos...\n");
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await getSafeBaileysVersion();
  state.detail = "Esperando respuesta de WhatsApp para generar el QR...";
  const socketConfig = {
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["Goloso Bot", "Chrome", "1.0"],
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
  };
  if (version) socketConfig.version = version;
  const sock = makeWASocket(socketConfig);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      state.status = "qr";
      state.qr = qr;
      state.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      state.detail = "QR generado. Escanéalo con WhatsApp Business.";
      logger.info("QR generated");
      console.log("\n✅ QR generado. Escanéalo desde WhatsApp Business.\n");
      try {
        console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
      } catch {
        console.log("Abre http://localhost:8790 para ver el QR.");
      }
      pushStatus();
    }
    if (connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.qrDataUrl = null;
      state.phone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      state.detail = "Conectado correctamente.";
      logger.info({ phone: state.phone }, "connected");
      console.log(`\n✅ WhatsApp conectado${state.phone ? `: +${state.phone}` : ""}.\n`);
      pushStatus();
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn({ code, shouldReconnect }, "connection closed");
      state.status = "disconnected";
      state.qr = null;
      state.qrDataUrl = null;
      state.detail = shouldReconnect ? "Conexión cerrada. Reintentando automáticamente..." : "Sesión cerrada desde WhatsApp. Borra auth_state y vuelve a instalar para generar un QR nuevo.";
      pushStatus();
      if (shouldReconnect) setTimeout(() => startSocket().catch((e) => logger.error(e)), 5000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid?.endsWith("@g.us")) continue; // ignorar grupos
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";
      const from = (msg.key.remoteJid || "").split("@")[0];
      if (!from) continue;
      logger.info({ from, textLen: text.length }, "incoming");
      const reply = await handleIncoming(from, text);
      if (reply) {
        await new Promise((r) => setTimeout(r, humanDelay()));
        try {
          await sock.sendMessage(msg.key.remoteJid, { text: reply });
          logger.info({ from }, "replied");
        } catch (e) {
          logger.warn({ err: String(e) }, "reply send failed");
        }
      }
    }
  });

  return sock;
}

function startLocalUI() {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url?.startsWith("/?")) {
      const statusColor = state.status === "connected" ? "#059669" : state.status === "qr" ? "#f59e0b" : "#dc2626";
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Goloso Bot</title>
<meta http-equiv="refresh" content="5">
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;margin:0;display:grid;place-items:center;padding:2rem}
.card{background:#1e293b;border-radius:16px;padding:2rem;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center}
h1{margin:0 0 .5rem;font-size:1.5rem}
.status{display:inline-flex;align-items:center;gap:.5rem;padding:.5rem 1rem;border-radius:999px;background:${statusColor};color:white;font-weight:600;margin:.75rem 0}
.phone{color:#94a3b8;font-size:.875rem}
img{max-width:100%;background:white;padding:1rem;border-radius:12px;margin-top:1rem}
.note{color:#94a3b8;font-size:.8rem;margin-top:1.5rem;line-height:1.5}.ok{color:#86efac}.err{color:#fecaca;background:#7f1d1d66;border:1px solid #ef444466;border-radius:10px;padding:.75rem;margin-top:1rem;text-align:left;word-break:break-word}
</style></head><body>
<div class="card">
<h1>🍨 Goloso — WhatsApp Bot</h1>
<div class="status">● ${state.status.toUpperCase()}</div>
${state.phone ? `<div class="phone">Número: +${escapeHtml(state.phone)}</div>` : ""}
${state.detail ? `<p class="note">${escapeHtml(state.detail)}</p>` : ""}
${state.qrDataUrl ? `<img src="${state.qrDataUrl}" alt="QR">` : ""}
${state.status === "qr" ? `<p class="note">Abre WhatsApp Business → menú → Dispositivos vinculados → Vincular un dispositivo, y escanea este código.</p>` : ""}
${state.status === "connected" ? `<p class="note">Todo funcionando. Puedes cerrar esta ventana. El bot corre en segundo plano.</p>` : ""}
${state.status === "disconnected" ? `<p class="note">Intentando reconectar automáticamente…</p>` : ""}
${state.status === "connecting" && !state.qrDataUrl ? `<p class="note">Si pasan más de 60 segundos, revisa que el PC tenga internet y que WhatsApp Web no esté bloqueado por antivirus/firewall.</p>` : ""}
${state.lastPushAt ? `<p class="note ok">Panel POS sincronizado.</p>` : ""}
${state.lastError ? `<div class="err"><b>Aviso de conexión.</b><br>${escapeHtml(state.lastError)}</div>` : ""}
${state.lastPushError ? `<div class="err"><b>No se pudo sincronizar con el POS.</b><br>${escapeHtml(state.lastPushError)}<br><br>Revisa que el token sea el de la sede seleccionada y que la app esté publicada.</div>` : ""}
<p class="note">Este panel se actualiza solo cada 5s.<br>Config y bienvenidas se editan desde el POS.</p>
</div></body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.url === "/status.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: state.status, phone: state.phone, detail: state.detail, lastError: state.lastError, lastPushAt: state.lastPushAt, lastPushError: state.lastPushError, hasQr: Boolean(state.qr) }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(LOCAL_PORT, () => {
    console.log(`\n✅ Panel local: http://localhost:${LOCAL_PORT}\n`);
  });
}

async function main() {
  console.log(`\n🍨 Goloso WhatsApp Bot`);
  console.log(`   API POS : ${config.apiUrl}`);
  console.log(`   Token   : ${config.token.slice(0, 6)}…${config.token.slice(-4)}`);
  startLocalUI();
  setInterval(pushStatus, HEARTBEAT_MS);
  void pushStatus();
  await startSocket().catch((e) => {
    logger.error(e);
    state.status = "error";
    state.lastError = String(e);
    pushStatus();
  });
}

main();
