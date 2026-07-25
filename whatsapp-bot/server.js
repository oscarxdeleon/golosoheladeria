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
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const AUTH_DIR = path.join(__dirname, "auth_state");
const inferredBranchPort = /sede\s*2|sede2|parque/i.test(__dirname) ? 8791 : 8790;
const REQUESTED_LOCAL_PORT = Number(process.env.PORT) || inferredBranchPort;
const LOCAL_PORT_SCAN_LIMIT = 20;
const HEARTBEAT_MS = 10_000;
const OUTBOUND_POLL_MS = 5_000;
const REPLY_DELAY_MIN = 2000;
const REPLY_DELAY_MAX = 5000;
const OUTBOUND_DELAY_MIN = 1500;
const OUTBOUND_DELAY_MAX = 3500;
const VERSION_FETCH_TIMEOUT_MS = 7_000;
const BACKEND_REQUEST_TIMEOUT_MS = 45_000;
const BACKEND_RETRY_DELAY_MS = 900;
const AI_MAX_AUDIO_BYTES = 1_500_000; // ~1.5 MB → notas de voz cortas
const BOT_VERSION = "8.18.0";
const WATCHDOG_INTERVAL_MS = 60_000;          // revisa cada minuto
const WATCHDOG_MAX_DISCONNECTED_MS = 5 * 60_000; // 5 min sin conexión → exit
const WATCHDOG_MAX_NO_HEARTBEAT_MS = 10 * 60_000; // 10 min sin ningún evento → exit
const CANONICAL_API_URL = "https://golosoheladeria.lovable.app";
const LEGACY_API_HOSTS = new Set(["golosoheladeria.vercel.app"]);
const SIGNAL_REPAIR_THRESHOLD = 1;
const SIGNAL_REPAIR_WINDOW_MS = 90_000;
const SIGNAL_REPAIR_COOLDOWN_MS = 120_000;
const SESSION_BACKUP_DIR = path.join(__dirname, "auth_state_backups");
const SESSION_BACKUP_LATEST_DIR = path.join(SESSION_BACKUP_DIR, "latest");
const SESSION_META_PATH = path.join(__dirname, "session-meta.json");
const SESSION_RESTORE_MARKER = path.join(__dirname, ".session-restore-attempted");

let signalDecryptErrorTimes = [];
let signalRepairInFlight = false;
let lastSignalRepairAt = 0;
let suppressAutoReconnectUntil = 0;

function safeStringify(value) {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ""}`;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeLog(level, args) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${args.map(safeStringify).join(" ")}\n`;
  fs.appendFile(path.join(__dirname, "bot.log"), line, () => {});
}

function isSignalDecryptError(args) {
  const text = args.map(safeStringify).join(" ");
  return /Failed to decrypt message|Bad MAC|MAC verification failed|MessageCounterError|Key used already|never filled|No session found/i.test(text);
}

function recordSignalDecryptError(args) {
  if (!isSignalDecryptError(args)) return;
  const now = Date.now();
  signalDecryptErrorTimes = [...signalDecryptErrorTimes.filter((at) => now - at < SIGNAL_REPAIR_WINDOW_MS), now];
  if (signalDecryptErrorTimes.length >= SIGNAL_REPAIR_THRESHOLD) {
    setTimeout(() => repairSignalSessions("errores repetidos de cifrado de WhatsApp").catch((e) => logger.warn({ err: String(e) }, "signal repair failed")), 250);
  }
}

function createSafeLogger(prefix = "") {
  const emit = (level, args) => {
    const finalArgs = prefix ? [prefix, ...args] : args;
    recordSignalDecryptError(finalArgs);
    writeLog(level, finalArgs);
  };
  return {
    level: "info",
    trace: (...args) => emit("trace", args),
    debug: (...args) => emit("debug", args),
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),
    fatal: (...args) => emit("fatal", args),
    child: (bindings = {}) => createSafeLogger(`${prefix}${prefix ? " " : ""}${safeStringify(bindings)}`),
  };
}

const logger = createSafeLogger();
installConsoleSignalRepairHook();
let activeLocalPort = REQUESTED_LOCAL_PORT;

function installConsoleSignalRepairHook() {
  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      try { recordSignalDecryptError(args); } catch { /* noop */ }
      original(...args);
    };
  }
}

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

function normalizeApiUrl(value) {
  try {
    const parsed = new URL(String(value || CANONICAL_API_URL).trim());
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    if (LEGACY_API_HOSTS.has(parsed.hostname)) return CANONICAL_API_URL;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return CANONICAL_API_URL;
  }
}

const config = loadConfig();
const originalApiUrl = config.apiUrl;
config.apiUrl = normalizeApiUrl(config.apiUrl);
if (originalApiUrl !== config.apiUrl) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...config, apiUrl: config.apiUrl }, null, 2));
    console.log(`\nℹ️ API POS actualizada automáticamente: ${config.apiUrl}\n`);
  } catch (e) {
    logger.warn({ err: String(e) }, "could not persist canonical apiUrl");
  }
}

let state = {
  status: "connecting",     // connecting | qr | connected | disconnected | error
  qr: null,                  // string cuando status === "qr"
  qrDataUrl: null,           // dataURL para servir en localhost
  phone: null,
  lastError: null,
  lastPushError: null,
  lastPushAt: null,
  lastOutboundPollAt: null,
  lastOutboundCount: 0,
  lastOutboundError: null,
  lastIncomingAt: null,
  lastIncomingFrom: null,
  lastIncomingPreview: null,
  lastReplyAt: null,
  lastReplySource: null,
  lastReplyError: null,
  lastAiError: null,
  lastConversationId: null,
  lastBackendLatencyMs: null,
  detail: "Iniciando conexión con WhatsApp...",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postBackendJson(payload, { label = "backend", timeoutMs = BACKEND_REQUEST_TIMEOUT_MS, retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, token: config.token, version: BOT_VERSION }),
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      state.lastBackendLatencyMs = Date.now() - started;
      logger.info({ label, attempt, status: res.status, ms: state.lastBackendLatencyMs, conversationId: data?.conversation_id }, "backend response");
      if (data?.conversation_id) state.lastConversationId = data.conversation_id;
      if (res.ok || (res.status < 500 && res.status !== 429)) return { ok: res.ok, status: res.status, data, text };
      lastErr = `HTTP ${res.status}: ${text.slice(0, 300)}`;
    } catch (e) {
      lastErr = e?.name === "AbortError" ? `${label} timeout ${Math.round(timeoutMs / 1000)}s` : String(e);
      logger.warn({ label, attempt, err: lastErr }, "backend request failed");
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await wait(BACKEND_RETRY_DELAY_MS * (attempt + 1));
  }
  return { ok: false, status: 0, data: null, text: lastErr || "backend_request_failed", error: lastErr || "backend_request_failed" };
}

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
      version: BOT_VERSION,
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
      return;
    }
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
    // Ejecutar comando remoto si el POS lo pidió (unlink | reconnect).
    if (data?.pending_command) {
      const cmd = String(data.pending_command);
      logger.info({ cmd }, "remote command received");
      executeRemoteCommand(cmd).catch((e) => logger.warn({ err: String(e) }, "remote command failed"));
    }
  } catch (e) {
    state.lastPushError = String(e);
    logger.warn({ err: String(e) }, "status push error");
  }
}

async function ackCommand(cmd) {
  try {
    await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "command_ack", token: config.token, command: cmd }),
    });
  } catch (e) {
    logger.warn({ err: String(e) }, "ack command failed");
  }
}

function rmAuthDir() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      logger.info("auth_state removed");
    }
  } catch (e) {
    logger.warn({ err: String(e) }, "could not remove auth_state");
  }
}

function resetAuthStateForFreshQr(reason = "logged_out") {
  try {
    rmAuthDir();
    fs.rmSync(SESSION_BACKUP_DIR, { recursive: true, force: true });
    fs.rmSync(SESSION_META_PATH, { force: true });
    fs.rmSync(SESSION_RESTORE_MARKER, { force: true });
    state.phone = null;
    state.qr = null;
    state.qrDataUrl = null;
    state.lastError = null;
    logger.warn({ reason }, "auth_state and backups cleared to generate a fresh QR");
    return true;
  } catch (e) {
    state.lastError = `No se pudo limpiar la sesión para generar QR nuevo: ${String(e)}`;
    logger.warn({ err: String(e), reason }, "fresh QR reset failed");
    return false;
  }
}

function copyDirSafe(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

function readSessionMeta() {
  try {
    if (!fs.existsSync(SESSION_META_PATH)) return null;
    return JSON.parse(fs.readFileSync(SESSION_META_PATH, "utf-8"));
  } catch (e) {
    logger.warn({ err: String(e) }, "could not read session meta");
    return null;
  }
}

function writeSessionMeta(phone) {
  if (!phone) return;
  try {
    const meta = {
      phone: String(phone),
      updatedAt: new Date().toISOString(),
      folder: __dirname,
      version: BOT_VERSION,
    };
    fs.writeFileSync(SESSION_META_PATH, JSON.stringify(meta, null, 2));
  } catch (e) {
    logger.warn({ err: String(e) }, "could not write session meta");
  }
}

function hasUsableAuthState(dir = AUTH_DIR) {
  try {
    return fs.existsSync(path.join(dir, "creds.json"));
  } catch {
    return false;
  }
}

function backupAuthState(reason = "manual") {
  try {
    if (!hasUsableAuthState(AUTH_DIR)) return false;
    copyDirSafe(AUTH_DIR, SESSION_BACKUP_LATEST_DIR);
    const meta = readSessionMeta();
    const backupMeta = {
      ...(meta || {}),
      reason,
      backedUpAt: new Date().toISOString(),
      version: BOT_VERSION,
    };
    fs.writeFileSync(path.join(SESSION_BACKUP_DIR, "latest-meta.json"), JSON.stringify(backupMeta, null, 2));
    logger.info({ reason, phone: backupMeta.phone }, "auth_state backup refreshed");
    return true;
  } catch (e) {
    logger.warn({ err: String(e), reason }, "auth_state backup failed");
    return false;
  }
}

function restoreAuthStateFromBackup(reason = "startup") {
  try {
    if (!hasUsableAuthState(SESSION_BACKUP_LATEST_DIR)) return false;
    const expectedPhone = String(config.expectedPhone || config.phone || "").replace(/\D/g, "");
    const metaPath = path.join(SESSION_BACKUP_DIR, "latest-meta.json");
    let backupPhone = "";
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        backupPhone = String(meta.phone || "").replace(/\D/g, "");
      } catch { /* noop */ }
    }
    if (!expectedPhone) {
      logger.warn({ reason, backupPhone }, "backup skipped because expected phone is not configured");
      return false;
    }
    if (!backupPhone || expectedPhone !== backupPhone) {
      logger.warn({ expectedPhone, backupPhone }, "backup rejected because phone does not match config");
      return false;
    }
    copyDirSafe(SESSION_BACKUP_LATEST_DIR, AUTH_DIR);
    fs.writeFileSync(SESSION_RESTORE_MARKER, new Date().toISOString());
    state.lastError = `Se restauró automáticamente la sesión guardada de WhatsApp (${reason}).`;
    logger.warn({ reason, backupPhone }, "auth_state restored from backup");
    return true;
  } catch (e) {
    logger.warn({ err: String(e), reason }, "auth_state restore failed");
    return false;
  }
}

function ensureAuthStateBeforeConnect() {
  if (hasUsableAuthState(AUTH_DIR)) return;
  restoreAuthStateFromBackup("faltaba auth_state/creds.json antes de conectar");
}

async function tryRestoreAfterLogout(reason) {
  logger.warn({ reason }, "logged out session will not be restored; forcing fresh QR");
  return false;
}

async function startFreshPairingAfterLogout(reason) {
  resetAuthStateForFreshQr(reason);
  if (currentSock) {
    try { currentSock.ws?.close?.(); } catch { /* noop */ }
    currentSock = null;
  }
  state.status = "connecting";
  state.detail = "WhatsApp cerró la sesión anterior. Se limpió la sesión local, las copias antiguas y se está generando un QR nuevo.";
  await pushStatus();
  setTimeout(() => startSocket().catch((e) => logger.error(e)), 2500);
}

function removeSignalSessionFiles() {
  if (!fs.existsSync(AUTH_DIR)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(AUTH_DIR)) {
    if (!/^(session-|sender-key-)/i.test(file)) continue;
    try {
      fs.rmSync(path.join(AUTH_DIR, file), { force: true });
      removed += 1;
    } catch (e) {
      logger.warn({ file, err: String(e) }, "could not remove stale signal session file");
    }
  }
  return removed;
}

async function repairSignalSessions(reason) {
  const now = Date.now();
  if (signalRepairInFlight) return;
  if (now - lastSignalRepairAt < SIGNAL_REPAIR_COOLDOWN_MS) return;
  signalRepairInFlight = true;
  lastSignalRepairAt = now;
  signalDecryptErrorTimes = [];
  suppressAutoReconnectUntil = now + 15_000;
  try {
    state.status = "connecting";
    state.detail = "Reparando sesión cifrada de WhatsApp sin borrar el QR...";
    state.lastError = `WhatsApp reportó ${reason}. Se limpiaron claves temporales y se reconectará automáticamente.`;
    logger.warn({ reason }, "repairing stale WhatsApp signal sessions");
    if (currentSock) {
      try { currentSock.ws?.close?.(); } catch { /* noop */ }
      currentSock = null;
    }
    const removed = removeSignalSessionFiles();
    logger.warn({ removed }, "stale signal session files removed");
    await pushStatus();
    setTimeout(() => {
      signalRepairInFlight = false;
      startSocket().catch((e) => {
        signalRepairInFlight = false;
        logger.error(e);
      });
    }, 2500);
  } catch (e) {
    signalRepairInFlight = false;
    logger.warn({ err: String(e) }, "signal repair error");
  }
}

let commandInFlight = false;
async function executeRemoteCommand(cmd) {
  if (commandInFlight) return;
  commandInFlight = true;
  try {
    if (cmd === "unlink") {
      state.detail = "Desvinculando dispositivo por solicitud del POS...";
      if (currentSock) {
        try { await currentSock.logout(); } catch (e) { logger.warn({ err: String(e) }, "logout error"); }
        try { currentSock.ws?.close?.(); } catch { /* noop */ }
        currentSock = null;
      }
      resetAuthStateForFreshQr("desvinculación solicitada desde POS");
      await ackCommand("unlink");
      state.status = "connecting";
      state.qr = null;
      state.qrDataUrl = null;
      state.phone = null;
      state.detail = "Sesión eliminada. Generando nuevo QR...";
      await pushStatus();
      setTimeout(() => startSocket().catch((e) => logger.error(e)), 1500);
      return;
    }
    if (cmd === "reconnect") {
      state.detail = "Reconectando por solicitud del POS...";
      if (currentSock) {
        try { currentSock.ws?.close?.(); } catch { /* noop */ }
        currentSock = null;
      }
      await ackCommand("reconnect");
      state.status = "connecting";
      await pushStatus();
      setTimeout(() => startSocket().catch((e) => logger.error(e)), 1500);
      return;
    }
    if (cmd === "restart") {
      state.detail = "Reiniciando servicio por solicitud del POS...";
      await ackCommand("restart");
      await pushStatus();
      logger.warn("remote restart requested — exiting so PM2 respawns");
      setTimeout(() => process.exit(0), 1200);
      return;
    }
    if (cmd === "update") {
      state.detail = "Actualizando bot por solicitud del POS...";
      await ackCommand("update");
      await pushStatus();
      try {
        const script = path.join(__dirname, "update-linux.sh");
        if (!fs.existsSync(script)) {
          logger.warn({ script }, "update-linux.sh no encontrado");
          return;
        }
        const logPath = path.join(__dirname, "last-update.log");
        const out = fs.openSync(logPath, "a");
        const child = spawn("bash", [script, __dirname], {
          detached: true,
          stdio: ["ignore", out, out],
          env: { ...process.env },
        });
        child.unref();
        logger.warn({ pid: child.pid, logPath }, "update script launched (PM2 respawnará el bot al terminar)");
      } catch (e) {
        logger.error({ err: String(e) }, "no se pudo lanzar update-linux.sh");
      }
      return;
    }
  } finally {
    commandInFlight = false;
  }
}


async function handleIncoming(from, body) {
  try {
    const res = await postBackendJson({ action: "incoming", from, message: body }, { label: "incoming" });
    if (!res.ok) {
      logger.warn({ status: res.status, body: res.text }, "incoming push failed");
      return { reply: null, error: res.text || `HTTP ${res.status}`, use_ai: true };
    }
    const data = res.data;
    return data && typeof data === "object" ? data : { reply: null };
  } catch (e) {
    logger.warn({ err: String(e) }, "incoming error");
    return { reply: null, error: String(e), use_ai: true };
  }
}

function buildSafetyReply() {
  return "Con gusto te atiendo. 🍦\n\nPuedes ver el menú actualizado con fotos y precios aquí 👉 https://golosoheladeria.lovable.app/menu\n\nSi quieres pedir por WhatsApp, dime qué producto te provoca y lo vamos armando paso a paso.";
}

async function requestAiReply(from, { text, audioB64, audioMime }) {
  try {
    const res = await postBackendJson({
      action: "ai_reply",
      from,
      text: text || "",
      audio_b64: audioB64 || "",
      audio_mime: audioMime || "",
    }, { label: "ai_reply", timeoutMs: 35_000, retries: 1 });
    if (!res.ok) {
      logger.warn({ status: res.status, body: res.text }, "ai_reply http fail");
      state.lastAiError = `ai_reply respondió HTTP ${res.status}`;
      return null;
    }
    const data = res.data || {};
    if (data.error) {
      state.lastAiError = String(data.error);
      logger.info({ err: data.error }, "ai_reply skipped");
    } else {
      state.lastAiError = null;
    }
    return data.reply || null;
  } catch (e) {
    const err = String(e);
    state.lastAiError = err;
    logger.warn({ err }, "ai_reply error");
    return null;
  }
}

async function sendReply(sock, msg, from, reply) {
  const targets = [];
  const originalJid = msg.key.remoteJid;
  if (originalJid) targets.push(originalJid);
  const phone = normalizeOutboundPhone(from);
  if (phone) targets.push(`${phone}@s.whatsapp.net`);
  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  let lastErr = null;
  for (const jid of uniqueTargets) {
    try {
      await withTimeout(sock.sendMessage(jid, { text: reply }), 15_000, "Enviar respuesta por WhatsApp");
      state.lastReplyAt = Date.now();
      state.lastReplyError = null;
      return { ok: true, jid };
    } catch (e) {
      lastErr = String(e);
      logger.warn({ err: lastErr, jid }, "reply send failed");
    }
  }
  state.lastReplyError = lastErr || "No se pudo enviar respuesta";
  return { ok: false, error: state.lastReplyError };
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

let currentSock = null;
let outboundInFlight = false;
const incomingQueues = new Map();

function enqueueIncoming(from, task) {
  const previous = incomingQueues.get(from) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .catch((e) => {
      logger.warn({ err: String(e), from }, "incoming task failed");
    })
    .finally(() => {
      if (incomingQueues.get(from) === next) incomingQueues.delete(from);
    });
  incomingQueues.set(from, next);
  return next;
}

async function processResolvedIncoming(sock, msg, from, text, audioNode, jid) {
  logger.info({ from, jid, textLen: text.length, hasAudio: !!audioNode }, "incoming");
  state.lastIncomingAt = Date.now();
  state.lastIncomingFrom = from;
  state.lastIncomingPreview = text ? text.slice(0, 120) : audioNode ? "[nota de voz]" : "[sin texto]";
  state.lastReplySource = null;
  state.lastReplyError = null;

  // 1) Respuesta fija del POS (bienvenida, menú, fuera de horario…)
  let reply = null;
  let incomingData = null;
  if (text) {
    incomingData = await handleIncoming(from, text);
    reply = typeof incomingData?.reply === "string" && incomingData.reply.trim() ? incomingData.reply : null;
    if (reply) state.lastReplySource = incomingData?.source || incomingData?.matched_trigger || "fixed";
  }

  // 2) Fallback IA: si no hubo respuesta fija Y hay texto o nota de voz,
  //    pedimos al backend un reply generado (respeta sandbox/límite/enabled).
  const shouldUseAi = !reply && (text || audioNode) && (audioNode || incomingData?.use_ai === true || incomingData?.error);
  if (shouldUseAi) {
    let audioB64 = "";
    let audioMime = "";
    if (audioNode) {
      try {
        const buf = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
        if (buf && buf.length <= AI_MAX_AUDIO_BYTES) {
          audioB64 = buf.toString("base64");
          audioMime = audioNode.mimetype || "audio/ogg";
        } else {
          logger.warn({ from, size: buf?.length }, "audio too large, skipping");
        }
      } catch (e) {
        logger.warn({ err: String(e) }, "audio download failed");
      }
    }
    reply = await requestAiReply(from, { text: text || "", audioB64, audioMime });
    if (reply) state.lastReplySource = "ai";
    if (!reply && shouldUseAi) {
      reply = buildSafetyReply();
      state.lastReplySource = "operational";
    }
  }

  if (reply) {
    await new Promise((r) => setTimeout(r, humanDelay()));
    const sent = await sendReply(sock, msg, from, reply);
    if (sent.ok) {
      logger.info({ from, source: state.lastReplySource, conversationId: state.lastConversationId }, "replied");
    }
  }
}

function normalizeOutboundPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `57${digits}`;
  return digits;
}

async function reportOutboundPoll(status, count = 0, error = null) {
  try {
    await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "poll_status",
        token: config.token,
        version: BOT_VERSION,
        pollStatus: status,
        pollCount: count,
        error,
      }),
    });
  } catch (e) {
    logger.warn({ err: String(e) }, "poll status report failed");
  }
}

async function pollOutbound() {
  if (!currentSock || state.status !== "connected") return;
  if (outboundInFlight) return;
  outboundInFlight = true;
  try {
    const res = await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pending", token: config.token, version: BOT_VERSION }),
    });
    if (!res.ok) {
      const txt = await res.text();
      const message = `pending respondió ${res.status}: ${txt.slice(0, 250)}`;
      state.lastOutboundError = message;
      await reportOutboundPoll("error", 0, message);
      return;
    }
    const data = await res.json();
    if (data?.error) {
      const message = `pending rechazado: ${data.error}`;
      state.lastOutboundError = message;
      await reportOutboundPoll("error", 0, message);
      return;
    }
    const pending = Array.isArray(data?.pending) ? data.pending : [];
    state.lastOutboundPollAt = Date.now();
    state.lastOutboundCount = pending.length;
    state.lastOutboundError = null;
    await reportOutboundPoll("ok", pending.length, null);
    if (pending.length === 0) return;
    const sent = [];
    const failed = [];
    let lastErr = null;
    for (const item of pending) {
      const to = normalizeOutboundPhone(item.to);
      if (!to || !item.body) { failed.push(item.id); continue; }
      const jid = `${to}@s.whatsapp.net`;
      try {
        const exists = await withTimeout(currentSock.onWhatsApp(jid).catch(() => null), 10_000, "Validar número de WhatsApp");
        if (Array.isArray(exists) && exists.length > 0 && exists[0]?.exists === false) {
          throw new Error(`El número ${to} no aparece activo en WhatsApp`);
        }
        await withTimeout(currentSock.sendMessage(jid, { text: String(item.body) }), 20_000, "Enviar mensaje saliente");
        sent.push(item.id);
        logger.info({ to }, "outbound sent");
        await new Promise((r) => setTimeout(r, OUTBOUND_DELAY_MIN + Math.random() * (OUTBOUND_DELAY_MAX - OUTBOUND_DELAY_MIN)));
      } catch (e) {
        failed.push(item.id);
        lastErr = String(e);
        logger.warn({ err: lastErr, to }, "outbound send failed");
      }
    }
    state.lastOutboundError = lastErr;
    await fetch(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ack", token: config.token, sent, failed, error: lastErr, version: BOT_VERSION }),
    });
  } catch (e) {
    const message = String(e);
    state.lastOutboundError = message;
    await reportOutboundPoll("error", 0, message);
    logger.warn({ err: message }, "poll outbound error");
  } finally {
    outboundInFlight = false;
  }
}

async function startSocket() {
  state.status = "connecting";
  state.detail = "Preparando sesión de WhatsApp...";
  console.log("\nConectando con WhatsApp. El QR puede tardar unos segundos...\n");
  ensureAuthStateBeforeConnect();
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await getSafeBaileysVersion();
  state.detail = "Esperando respuesta de WhatsApp para generar el QR...";
  const socketConfig = {
    auth: authState,
    printQRInTerminal: false,
    logger: createSafeLogger("baileys"),
    browser: ["Goloso Bot", "Chrome", "1.0"],
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
  };
  if (version) socketConfig.version = version;
  const sock = makeWASocket(socketConfig);

  sock.ev.on("creds.update", async (...args) => {
    await saveCreds(...args);
    backupAuthState("creds.update");
  });

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
        console.log(`Abre http://localhost:${activeLocalPort} para ver el QR.`);
      }
      pushStatus();
    }
    if (connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.qrDataUrl = null;
      state.phone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      state.detail = "Conectado correctamente.";
      writeSessionMeta(state.phone);
      backupAuthState("connection.open");
      try { if (fs.existsSync(SESSION_RESTORE_MARKER)) fs.rmSync(SESSION_RESTORE_MARKER, { force: true }); } catch { /* noop */ }
      logger.info({ phone: state.phone }, "connected");
      console.log(`\n✅ WhatsApp conectado${state.phone ? `: +${state.phone}` : ""}.\n`);
      pushStatus();
      setTimeout(() => pollOutbound().catch((e) => logger.warn({ err: String(e) }, "initial outbound poll failed")), 1200);
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn({ code, shouldReconnect }, "connection closed");
      if (Date.now() < suppressAutoReconnectUntil) {
        const waitMs = Math.max(1_000, suppressAutoReconnectUntil - Date.now() + 750);
        state.status = "connecting";
        state.detail = "Reconexión pausada brevemente mientras se repara la sesión cifrada. Se reintentará automáticamente.";
        pushStatus();
        setTimeout(() => startSocket().catch((e) => logger.error(e)), waitMs);
        return;
      }
      if (!shouldReconnect) {
        await startFreshPairingAfterLogout("WhatsApp reportó cierre de sesión y no hubo copia válida para restaurar");
        return;
      }
      state.status = "disconnected";
      state.qr = null;
      state.qrDataUrl = null;
      state.detail = "Conexión cerrada. Reintentando automáticamente...";
      pushStatus();
      setTimeout(() => startSocket().catch((e) => logger.error(e)), 5000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid || "";
      // Ignorar grupos, estados/historias, broadcasts y newsletters de WhatsApp.
      if (jid.endsWith("@g.us")) continue;
      if (jid.endsWith("@broadcast")) continue;
      if (jid.endsWith("@newsletter")) continue;
      if (jid.startsWith("status@")) continue;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";
      const audioNode = msg.message.audioMessage;
      // Baileys nuevo usa JIDs @lid (anónimos). El teléfono real puede venir en
      // varios campos según la versión de WhatsApp del cliente. Probamos todas
      // las fuentes conocidas para NO perder mensajes de números que no exponen
      // senderPn (síntoma típico: "solo un número funciona, el otro no").
      const extractPhone = (val) => {
        if (!val || typeof val !== "string") return "";
        const raw = val.split("@")[0].split(":")[0];
        return /^\d{6,}$/.test(raw) ? raw : "";
      };
      let phoneSource = "";
      const candidates = [
        !jid.endsWith("@lid") ? jid : "",
        msg.key.remoteJidAlt,
        msg.key.senderPn,
        msg.key.participantPn,
        msg.key.participantAlt,
        msg.key.participant,
        // último recurso: pushName no sirve, pero el LID a veces ES el número
        jid.endsWith("@lid") ? jid : "",
      ];
      for (const c of candidates) {
        phoneSource = extractPhone(c);
        if (phoneSource) break;
      }
      const from = phoneSource;
      if (!from || !/^\d{6,}$/.test(from)) {
        logger.warn(
          {
            jid,
            remoteJidAlt: msg.key.remoteJidAlt,
            senderPn: msg.key.senderPn,
            participantPn: msg.key.participantPn,
            participantAlt: msg.key.participantAlt,
            participant: msg.key.participant,
          },
          "phone_unresolved — mensaje ignorado (no se pudo extraer número)",
        );
        continue;
      }
      await enqueueIncoming(from, () => processResolvedIncoming(sock, msg, from, text, audioNode, jid));
    }
  });

  currentSock = sock;
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
${state.lastOutboundPollAt ? `<p class="note ok">Cola de reportes revisada: ${escapeHtml(new Date(state.lastOutboundPollAt).toLocaleTimeString())}${state.lastOutboundCount ? ` · ${state.lastOutboundCount} pendiente(s)` : ""}</p>` : ""}
${state.lastError ? `<div class="err"><b>Aviso de conexión.</b><br>${escapeHtml(state.lastError)}</div>` : ""}
${state.lastPushError ? `<div class="err"><b>No se pudo sincronizar con el POS.</b><br>${escapeHtml(state.lastPushError)}<br><br>Revisa que el token sea el de la sede seleccionada y que la app esté publicada.</div>` : ""}
${state.lastOutboundError ? `<div class="err"><b>No se pudo procesar la cola de reportes.</b><br>${escapeHtml(state.lastOutboundError)}</div>` : ""}
<p class="note">Este panel se actualiza solo cada 5s.<br>Config y bienvenidas se editan desde el POS.</p>
</div></body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.url === "/status.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: BOT_VERSION, status: state.status, phone: state.phone, detail: state.detail, lastError: state.lastError, lastPushAt: state.lastPushAt, lastPushError: state.lastPushError, lastIncomingAt: state.lastIncomingAt, lastIncomingFrom: state.lastIncomingFrom, lastIncomingPreview: state.lastIncomingPreview, lastReplyAt: state.lastReplyAt, lastReplySource: state.lastReplySource, lastReplyError: state.lastReplyError, lastAiError: state.lastAiError, lastConversationId: state.lastConversationId, lastBackendLatencyMs: state.lastBackendLatencyMs, hasQr: Boolean(state.qr), port: activeLocalPort, folder: __dirname }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on("error", (error) => {
    const message = `Panel local no disponible: ${error?.message || String(error)}`;
    state.lastError = message;
    logger.warn({ err: message }, "local ui error ignored");
    console.warn(`\n⚠️ ${message}\nEl bot seguirá funcionando sin panel local.\n`);
  });
  listenOnAvailablePort(server, REQUESTED_LOCAL_PORT, LOCAL_PORT_SCAN_LIMIT);
}

function listenOnAvailablePort(server, port, remainingAttempts) {
  const onError = (error) => {
    server.off("listening", onListening);
    if (error?.code === "EADDRINUSE" && remainingAttempts > 0) {
      const nextPort = port + 1;
      console.warn(`\n⚠️ El puerto ${port} ya está ocupado. Probando puerto ${nextPort}...\n`);
      logger.warn({ port, nextPort }, "local ui port busy; trying next port");
      const nextServer = http.createServer(server.listeners("request")[0]);
      nextServer.on("error", (fallbackError) => server.emit("error", fallbackError));
      setTimeout(() => listenOnAvailablePort(nextServer, nextPort, remainingAttempts - 1), 250);
      return;
    }
    const message = `No se pudo abrir el panel local en el puerto ${port}: ${error?.message || String(error)}`;
    state.lastError = message;
    logger.warn({ err: message }, "local ui listen failed");
    console.warn(`\n⚠️ ${message}\nEl bot seguirá funcionando sin panel local.\n`);
  };
  const onListening = () => {
    server.off("error", onError);
    activeLocalPort = port;
    console.log(`\n✅ Panel local: http://localhost:${activeLocalPort}\n`);
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port);
}

async function main() {
  console.log(`\n🍨 Goloso WhatsApp Bot`);
  console.log(`   Versión : ${BOT_VERSION}`);
  console.log(`   Carpeta : ${__dirname}`);
  console.log(`   API POS : ${config.apiUrl}`);
  console.log(`   Token   : ${config.token.slice(0, 6)}…${config.token.slice(-4)}`);
  startLocalUI();
  setInterval(pushStatus, HEARTBEAT_MS);
  setInterval(pollOutbound, OUTBOUND_POLL_MS);
  void pushStatus();

  // ---- Watchdog: auto-reinicio si el bot queda "pegado" ----
  // pm2 (o systemd/nssm) volverá a levantar el proceso al hacer exit(1).
  let watchdogSince = Date.now();
  let watchdogLastStatus = state.status;
  setInterval(() => {
    const now = Date.now();
    if (state.status !== watchdogLastStatus) {
      watchdogLastStatus = state.status;
      watchdogSince = now;
    }
    const stuckMs = now - watchdogSince;
    const noHeartbeatMs = state.lastIncomingAt || state.lastReplyAt
      ? now - Math.max(state.lastIncomingAt || 0, state.lastReplyAt || 0)
      : 0;

    if ((state.status === "disconnected" || state.status === "connecting" || state.status === "error")
        && stuckMs > WATCHDOG_MAX_DISCONNECTED_MS) {
      logger.error({ status: state.status, stuckMs }, "watchdog: sin conexión >5min, reiniciando proceso");
      console.error(`\n⚠️  Watchdog: sin conexión hace ${Math.round(stuckMs/1000)}s. Reiniciando…\n`);
      process.exit(1);
    }
    if (state.status === "connected" && noHeartbeatMs > WATCHDOG_MAX_NO_HEARTBEAT_MS) {
      logger.warn({ noHeartbeatMs }, "watchdog: sin actividad >10min, reiniciando por precaución");
      process.exit(1);
    }
  }, WATCHDOG_INTERVAL_MS);

  // Errores no controlados: log y salida (pm2 lo revive)
  process.on("uncaughtException", (err) => {
    logger.error({ err: String(err), stack: err?.stack }, "uncaughtException — saliendo para reinicio");
    console.error("uncaughtException:", err);
    setTimeout(() => process.exit(1), 500);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: safeStringify(reason) }, "unhandledRejection");
  });

  await startSocket().catch((e) => {
    logger.error(e);
    state.status = "error";
    state.lastError = String(e);
    pushStatus();
  });
}

main();
