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
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const LEGACY_AUTH_DIR = path.join(__dirname, "auth_state");
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
const STATUS_PUSH_TIMEOUT_MS = 8_000;
const OUTBOUND_REQUEST_TIMEOUT_MS = 18_000;
const INCOMING_TASK_TIMEOUT_MS = 70_000;
const PROCESSED_MESSAGE_TTL_MS = 30 * 60_000;
const PROCESSED_MESSAGE_MAX = 2000;
const AI_MAX_AUDIO_BYTES = 1_500_000; // ~1.5 MB → notas de voz cortas
const BOT_VERSION = "8.22.9";
const WATCHDOG_INTERVAL_MS = 30_000;          // revisa cada 30s
const WATCHDOG_MAX_DISCONNECTED_MS = 3 * 60_000; // 3 min sin conexión real → exit
const WATCHDOG_MAX_OUTBOUND_STALE_MS = 2 * 60_000; // conectado pero sin revisar cola → exit
const LOGGED_OUT_RECOVERY_WINDOW_MS = 10 * 60_000;
const LOGGED_OUT_MAX_PRESERVED_RETRIES = 3;
const CANONICAL_API_URL = "https://golosoheladeria.lovable.app";
const RELEASE_MANIFEST_URL = `${CANONICAL_API_URL}/downloads/manifest.json`;
const LATEST_LINUX_UPDATE_URL = `${CANONICAL_API_URL}/downloads/update-linux.sh`;
const LATEST_WINDOWS_UPDATE_URL = `${CANONICAL_API_URL}/downloads/actualizar-bot-windows-remoto.bat`;
const LEGACY_API_HOSTS = new Set(["golosoheladeria.vercel.app"]);
const SIGNAL_REPAIR_THRESHOLD = 3;
const SIGNAL_REPAIR_WINDOW_MS = 90_000;
const SIGNAL_REPAIR_COOLDOWN_MS = 120_000;
const INSTANCE_LOCK_PATH = path.join(__dirname, ".goloso-bot.lock");
const INSTANCE_STARTED_AT = new Date().toISOString();
const INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let signalDecryptErrorTimes = [];
let signalRepairInFlight = false;
let lastSignalRepairAt = 0;
let suppressAutoReconnectUntil = 0;
let instanceRetired = false;
let lastBaileysEventAt = Date.now();
let connectedSince = null;
let notConnectedSince = Date.now();

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

function markBaileysEvent(label = "event") {
  lastBaileysEventAt = Date.now();
  state.lastBaileysEventAt = lastBaileysEventAt;
  state.lastBaileysEvent = label;
}

function markConnectionState(status) {
  const now = Date.now();
  state.status = status;
  if (status === "connected") {
    connectedSince = now;
    notConnectedSince = null;
    markBaileysEvent("connection.open");
  } else {
    connectedSince = null;
    if (!notConnectedSince) notConnectedSince = now;
  }
}

function forceProcessRestart(reason, extra = {}) {
  logger.error({ reason, ...extra }, "watchdog: reinicio forzado del proceso");
  state.lastError = reason;
  try { currentSock?.ws?.close?.(); } catch { /* noop */ }
  setTimeout(() => process.exit(1), 500);
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

function safePathSegment(value, fallback = "default") {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function sessionFingerprint() {
  return createHash("sha256")
    .update(String(config.token || __dirname))
    .digest("hex")
    .slice(0, 18);
}

function windowsDataRoot() {
  return process.env.GOLOSO_BOT_DATA_DIR
    || process.env.APPDATA
    || process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || __dirname, "AppData", "Roaming");
}

function persistentAuthDir() {
  if (process.env.GOLOSO_BOT_SESSION_DIR) return process.env.GOLOSO_BOT_SESSION_DIR;
  if (process.platform !== "win32") return LEGACY_AUTH_DIR;
  return path.join(windowsDataRoot(), "Goloso WhatsApp Bot", "sessions", `sede-${sessionFingerprint()}`);
}

const AUTH_DIR = persistentAuthDir();
const SESSION_BACKUP_DIR = process.platform === "win32"
  ? path.join(windowsDataRoot(), "Goloso WhatsApp Bot", "session-backups", sessionFingerprint())
  : path.join(__dirname, "auth_state_backups");
const SESSION_BACKUP_LATEST_DIR = path.join(SESSION_BACKUP_DIR, "latest");
const SESSION_META_PATH = process.platform === "win32"
  ? path.join(windowsDataRoot(), "Goloso WhatsApp Bot", "session-meta", `${sessionFingerprint()}.json`)
  : path.join(__dirname, "session-meta.json");
const SESSION_RESTORE_MARKER = process.platform === "win32"
  ? path.join(windowsDataRoot(), "Goloso WhatsApp Bot", "session-meta", `${sessionFingerprint()}.restore-attempted`)
  : path.join(__dirname, ".session-restore-attempted");
const LOGGED_OUT_RECOVERY_PATH = process.platform === "win32"
  ? path.join(windowsDataRoot(), "Goloso WhatsApp Bot", "session-meta", `${sessionFingerprint()}.logged-out-recovery.json`)
  : path.join(__dirname, ".logged-out-recovery.json");

for (const folder of [AUTH_DIR, SESSION_BACKUP_DIR, path.dirname(SESSION_META_PATH)]) {
  try { fs.mkdirSync(folder, { recursive: true }); } catch { /* noop */ }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readInstanceLock() {
  try {
    if (!fs.existsSync(INSTANCE_LOCK_PATH)) return null;
    return JSON.parse(fs.readFileSync(INSTANCE_LOCK_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeInstanceLock() {
  const payload = {
    pid: process.pid,
    instanceId: INSTANCE_ID,
    startedAt: INSTANCE_STARTED_AT,
    folder: __dirname,
    tokenTail: String(config.token || "").slice(-6),
    version: BOT_VERSION,
  };
  fs.writeFileSync(INSTANCE_LOCK_PATH, JSON.stringify(payload, null, 2));
}

function releaseInstanceLock() {
  try {
    const current = readInstanceLock();
    if (current?.instanceId === INSTANCE_ID) fs.rmSync(INSTANCE_LOCK_PATH, { force: true });
  } catch { /* noop */ }
}

function acquireInstanceLock() {
  const current = readInstanceLock();
  const currentPid = Number(current?.pid || 0);
  if (current?.instanceId && isProcessAlive(currentPid)) {
    const message = `Ya existe otro Goloso Bot activo en esta carpeta (PID ${currentPid}). Este proceso queda inactivo para evitar estados duplicados.`;
    console.warn(`\n⚠️ ${message}\n`);
    logger.warn({ lock: current }, "duplicate bot instance blocked by local lock");
    return false;
  }
  if (current?.instanceId) {
    logger.warn({ lock: current }, "stale local lock replaced");
  }
  writeInstanceLock();
  process.on("exit", releaseInstanceLock);
  process.on("SIGINT", () => { releaseInstanceLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseInstanceLock(); process.exit(0); });
  return true;
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
  unresolvedPhoneCount: 0,
  lastUnresolvedJid: null,
  lastUnresolvedAt: null,
  detail: "Iniciando conexión con WhatsApp...",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = BACKEND_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compareVersions(a, b) {
  const pa = String(a || "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function checkOfficialBotVersionOnStartup() {
  try {
    const res = await fetchWithTimeout(`${RELEASE_MANIFEST_URL}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    }, VERSION_FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const manifest = await res.json();
    const officialVersion = String(manifest?.version || "").trim();
    if (!officialVersion) throw new Error("manifest sin version");
    if (compareVersions(BOT_VERSION, officialVersion) < 0) {
      state.detail = `Versión ${BOT_VERSION} obsoleta. Actualizando automáticamente a ${officialVersion}...`;
      state.lastError = null;
      await pushStatus();
      if (process.platform === "win32") {
        const child = launchWindowsSelfUpdate();
        logger.warn({ current: BOT_VERSION, official: officialVersion, pid: child.pid }, "outdated windows bot detected; self update started");
      } else {
        const { child, logPath } = launchLinuxSelfUpdate();
        logger.warn({ current: BOT_VERSION, official: officialVersion, pid: child.pid, logPath }, "outdated bot detected; self update started");
      }
    }
  } catch (e) {
    logger.warn({ err: String(e) }, "official bot version check skipped");
  }
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

let statusPushInFlight = false;
async function pushStatus() {
  if (instanceRetired) return;
  if (statusPushInFlight) return;
  statusPushInFlight = true;
  try {
    const body = {
      action: "status",
      status: state.status,
      qr: state.qr,
      phone: state.phone,
      instance_id: INSTANCE_ID,
      started_at: INSTANCE_STARTED_AT,
      unresolved_phone_count: state.unresolvedPhoneCount,
      last_unresolved_jid: state.lastUnresolvedJid,
      last_baileys_event_at: state.lastBaileysEventAt ? new Date(state.lastBaileysEventAt).toISOString() : null,
    };
    const response = await postBackendJson(body, { label: "status", timeoutMs: STATUS_PUSH_TIMEOUT_MS, retries: 1 });
    if (!response.ok) {
      state.lastPushError = `POS respondió ${response.status}: ${String(response.text ?? response.error ?? "sin respuesta").slice(0, 250)}`;
      logger.warn({ status: response.status, body: response.data ?? response.text }, "status push failed");
      return;
    }
    const data = response.data;
    if (data?.error) {
      state.lastPushError = `POS rechazó estado: ${data.error}`;
      logger.warn({ body: data }, "status push rejected");
      return;
    }
    state.lastPushError = null;
    state.lastPushAt = Date.now();
    if (data?.duplicate_instance && data?.active_instance_id && data.active_instance_id !== INSTANCE_ID) {
      retireDuplicateInstance(data.active_instance_id).catch((e) => logger.warn({ err: String(e) }, "duplicate retire failed"));
      return;
    }
    // Ejecutar comando remoto si el POS lo pidió (unlink | reconnect).
    if (data?.pending_command) {
      const cmd = String(data.pending_command);
      logger.info({ cmd }, "remote command received");
      executeRemoteCommand(cmd).catch((e) => logger.warn({ err: String(e) }, "remote command failed"));
    }
  } catch (e) {
    state.lastPushError = String(e);
    logger.warn({ err: String(e) }, "status push error");
  } finally {
    statusPushInFlight = false;
  }
}

async function retireDuplicateInstance(activeInstanceId) {
  if (instanceRetired) return;
  instanceRetired = true;
  markConnectionState("disconnected");
  state.detail = "Este proceso se pausó porque el POS ya detectó otra instancia activa del mismo bot. Esto evita que dos bots consuman los mismos mensajes.";
  state.lastError = `Instancia duplicada pausada. Instancia activa: ${activeInstanceId || "desconocida"}`;
  logger.warn({ activeInstanceId, instanceId: INSTANCE_ID }, "duplicate instance retired; closing WhatsApp socket");
  if (currentSock) {
    try { currentSock.ws?.close?.(); } catch { /* noop */ }
    currentSock = null;
  }
  releaseInstanceLock();
  setTimeout(() => process.exit(0), 2500);
}

async function ackCommand(cmd) {
  try {
    await fetchWithTimeout(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "command_ack", token: config.token, command: cmd }),
    }, STATUS_PUSH_TIMEOUT_MS);
  } catch (e) {
    logger.warn({ err: String(e) }, "ack command failed");
  }
}

function archiveAuthStateBeforeDestructiveAction(reason = "unknown") {
  try {
    if (!hasUsableAuthState(AUTH_DIR)) return false;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const archiveDir = path.join(SESSION_BACKUP_DIR, `protected-${stamp}`);
    copyDirSafe(AUTH_DIR, archiveDir);
    logger.warn({ reason, archiveDir }, "protected auth_state archive created before destructive action");
    return true;
  } catch (e) {
    logger.warn({ err: String(e), reason }, "could not create protected auth_state archive");
    return false;
  }
}

function rmAuthDir({ reason = "manual", allowDestructive = false } = {}) {
  try {
    if (!allowDestructive) {
      logger.warn({ reason, authDir: AUTH_DIR }, "auth_state deletion blocked by session preservation guard");
      state.lastError = "La sesión de WhatsApp está protegida y no fue eliminada. Usa Desvincular solo si realmente quieres generar QR nuevo.";
      return false;
    }
    archiveAuthStateBeforeDestructiveAction(reason);
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      logger.warn({ reason, authDir: AUTH_DIR }, "auth_state removed by explicit destructive action");
    }
    return true;
  } catch (e) {
    logger.warn({ err: String(e) }, "could not remove auth_state");
    return false;
  }
}

function resetAuthStateForFreshQr(reason = "logged_out", { allowDestructive = false } = {}) {
  try {
    const removed = rmAuthDir({ reason, allowDestructive });
    if (!allowDestructive || !removed) return false;
    const protectedArchives = [];
    if (fs.existsSync(SESSION_BACKUP_DIR)) {
      for (const entry of fs.readdirSync(SESSION_BACKUP_DIR, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith("protected-")) protectedArchives.push(entry.name);
      }
    }
    for (const entry of fs.readdirSync(SESSION_BACKUP_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("protected-")) continue;
      fs.rmSync(path.join(SESSION_BACKUP_DIR, entry.name), { recursive: true, force: true });
    }
    fs.rmSync(SESSION_META_PATH, { force: true });
    fs.rmSync(SESSION_RESTORE_MARKER, { force: true });
    state.phone = null;
    state.qr = null;
    state.qrDataUrl = null;
    state.lastError = null;
    logger.warn({ reason, protectedArchives }, "auth_state cleared only after explicit unlink command");
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

function migrateLegacyAuthState() {
  try {
    if (AUTH_DIR === LEGACY_AUTH_DIR) return false;
    if (hasUsableAuthState(AUTH_DIR)) return false;
    if (!hasUsableAuthState(LEGACY_AUTH_DIR)) return false;
    copyDirSafe(LEGACY_AUTH_DIR, AUTH_DIR);
    logger.warn({ from: LEGACY_AUTH_DIR, to: AUTH_DIR }, "legacy auth_state migrated to persistent Windows data folder");
    return true;
  } catch (e) {
    logger.warn({ err: String(e), from: LEGACY_AUTH_DIR, to: AUTH_DIR }, "legacy auth_state migration failed");
    return false;
  }
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
  migrateLegacyAuthState();
  if (hasUsableAuthState(AUTH_DIR)) return;
  restoreAuthStateFromBackup("faltaba auth_state/creds.json antes de conectar");
}

async function tryRestoreAfterLogout(reason) {
  const recoveryCount = recordLoggedOutRecovery(reason);
  logger.warn({ reason, recoveryCount }, "logged out reported; preserving auth_state and restarting before showing QR");
  state.lastError = null;
  state.detail = `WhatsApp cerró la conexión. Se conservaron las credenciales y el bot reintentará reconectar sin QR (${recoveryCount}/${LOGGED_OUT_MAX_PRESERVED_RETRIES}).`;
  const restored = restoreAuthStateFromBackup(`logged_out: ${reason}`);
  archiveAuthStateBeforeDestructiveAction(`logged_out_preserved: ${reason}`);
  return {
    canRetry: restored || hasUsableAuthState(AUTH_DIR),
    restored,
    recoveryCount,
  };
}

async function startFreshPairingAfterLogout(reason) {
  const recovery = await tryRestoreAfterLogout(reason);
  if (currentSock) {
    try { currentSock.ws?.close?.(); } catch { /* noop */ }
    currentSock = null;
  }
  markConnectionState("connecting");
  state.qr = null;
  state.qrDataUrl = null;
  if (recovery.canRetry && recovery.recoveryCount <= LOGGED_OUT_MAX_PRESERVED_RETRIES) {
    state.detail = recovery.restored
      ? "WhatsApp cerró la conexión; se restauró la copia segura de la sesión y el bot se reiniciará para reconectar sin QR."
      : "WhatsApp cerró la conexión; la sesión local se conservó y el bot se reiniciará para reconectar sin QR.";
    await pushStatus();
    restartProcessPreservingSession(`logged_out_preserved_${recovery.recoveryCount}`);
    return;
  }
  state.lastError = "WhatsApp confirmó que esta sesión ya no es válida después de varios reintentos seguros. Se generará un QR nuevo sin mezclar ni borrar respaldos protegidos.";
  state.detail = "Generando QR nuevo porque WhatsApp rechazó repetidamente la sesión guardada.";
  resetAuthStateForFreshQr(`logged_out_repeated: ${reason}`, { allowDestructive: true });
  await pushStatus();
  scheduleReconnect(1500, "logged_out_qr_after_safe_retries");
}

function recordLoggedOutRecovery(reason) {
  const now = Date.now();
  let attempts = [];
  try {
    if (fs.existsSync(LOGGED_OUT_RECOVERY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(LOGGED_OUT_RECOVERY_PATH, "utf-8"));
      attempts = Array.isArray(raw?.attempts) ? raw.attempts : [];
    }
  } catch { /* noop */ }
  attempts = attempts
    .map((entry) => ({ at: Number(entry?.at) || 0, reason: String(entry?.reason || "") }))
    .filter((entry) => now - entry.at < LOGGED_OUT_RECOVERY_WINDOW_MS);
  attempts.push({ at: now, reason: String(reason || "logged_out").slice(0, 180) });
  try {
    fs.mkdirSync(path.dirname(LOGGED_OUT_RECOVERY_PATH), { recursive: true });
    fs.writeFileSync(LOGGED_OUT_RECOVERY_PATH, JSON.stringify({ attempts }, null, 2));
  } catch (e) {
    logger.warn({ err: String(e) }, "could not persist logged_out recovery counter");
  }
  return attempts.length;
}

function clearLoggedOutRecovery() {
  try { fs.rmSync(LOGGED_OUT_RECOVERY_PATH, { force: true }); } catch { /* noop */ }
}

function restartProcessPreservingSession(reason) {
  logger.warn({ reason }, "restarting bot process while preserving WhatsApp session");
  state.lastError = null;
  state.detail = "Reiniciando el bot para reconectar WhatsApp sin pedir QR...";
  releaseInstanceLock();
  try {
    if (process.platform === "win32") {
      const starterPath = path.join(__dirname, "start-hidden.vbs");
      const command = `ping -n 3 127.0.0.1 >nul && wscript.exe //nologo "${starterPath}"`;
      launchDetached("cmd.exe", ["/c", command], {
        cwd: __dirname,
        env: { ...process.env },
        windowsHide: true,
      });
      setTimeout(() => process.exit(0), 1000);
      return;
    }
  } catch (e) {
    logger.warn({ err: String(e), reason }, "self restart spawn failed; falling back to normal reconnect");
    scheduleReconnect(5000, `self_restart_failed_${reason}`);
    return;
  }
  setTimeout(() => process.exit(1), 1000);
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
    markConnectionState("connecting");
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
      scheduleReconnect(250, "signal_session_repair");
    }, 2500);
  } catch (e) {
    signalRepairInFlight = false;
    logger.warn({ err: String(e) }, "signal repair error");
  }
}

let commandInFlight = false;
let commandStartedAt = 0;

function launchDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    ...options,
  });
  child.unref();
  return child;
}

function launchWindowsSelfUpdate() {
  const escapedUrl = `${LATEST_WINDOWS_UPDATE_URL}?v=${BOT_VERSION}&t=${Date.now()}`.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "$bat=Join-Path $env:TEMP ('goloso-bot-remoto-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '.bat')",
    "$headers=@{'Cache-Control'='no-cache';'Pragma'='no-cache'}",
    `Invoke-WebRequest -UseBasicParsing -Uri '${escapedUrl}' -Headers $headers -OutFile $bat -TimeoutSec 60`,
    "Start-Process -FilePath $bat -WorkingDirectory $env:TEMP",
  ].join("; ");
  return launchDetached("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { cwd: __dirname });
}

function launchWindowsRestart() {
  return launchDetached("wscript.exe", ["//nologo", path.join(__dirname, "start-hidden.vbs")], { cwd: __dirname });
}

function launchLinuxSelfUpdate() {
  const scriptPath = path.join(__dirname, "update-linux.sh");
  const logPath = path.join(__dirname, "last-update.log");
  const out = fs.openSync(logPath, "a");
  const command = [
    "set -Eeuo pipefail",
    `curl -fsSL '${LATEST_LINUX_UPDATE_URL}?v=${BOT_VERSION}' -o '${scriptPath}'`,
    `chmod +x '${scriptPath}'`,
    `bash '${scriptPath}' '${__dirname}'`,
  ].join(" && ");
  const child = spawn("bash", ["-lc", command], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
    cwd: __dirname,
  });
  child.unref();
  return { child, logPath };
}

async function executeRemoteCommand(cmd) {
  if (commandInFlight) {
    logger.warn({ cmd, commandStartedAt }, "remote command ignored because another command is still running");
    return;
  }
  commandInFlight = true;
  commandStartedAt = Date.now();
  try {
    if (cmd === "unlink") {
      state.detail = "Desvinculando dispositivo por solicitud del POS...";
      if (currentSock) {
        try { await withTimeout(currentSock.logout(), 12_000, "Cerrar sesión de WhatsApp"); } catch (e) { logger.warn({ err: String(e) }, "logout error"); }
        try { currentSock.ws?.close?.(); } catch { /* noop */ }
        currentSock = null;
      }
      resetAuthStateForFreshQr("desvinculación solicitada desde POS", { allowDestructive: true });
      await ackCommand("unlink");
      markConnectionState("connecting");
      state.qr = null;
      state.qrDataUrl = null;
      state.phone = null;
      state.detail = "Sesión eliminada. Generando nuevo QR...";
      await pushStatus();
      scheduleReconnect(1500, "remote_unlink");
      return;
    }
    if (cmd === "reconnect") {
      state.detail = "Reconectando por solicitud del POS...";
      if (currentSock) {
        try { currentSock.ws?.close?.(); } catch { /* noop */ }
        currentSock = null;
      }
      await ackCommand("reconnect");
    markConnectionState("connecting");
      await pushStatus();
      scheduleReconnect(1500, "remote_reconnect");
      return;
    }
    if (cmd === "restart") {
      state.detail = "Reiniciando servicio por solicitud del POS...";
      await ackCommand("restart");
      await pushStatus();
      if (process.platform === "win32") {
        const child = launchWindowsRestart();
        logger.warn({ pid: child.pid }, "remote restart requested — windows relauncher started");
      } else {
        logger.warn("remote restart requested — exiting so supervisor respawns");
      }
      setTimeout(() => process.exit(0), 1200);
      return;
    }
    if (cmd === "update") {
      state.detail = "Actualizando bot por solicitud del POS...";
      await ackCommand("update");
      await pushStatus();
      try {
        if (process.platform === "win32") {
          const child = launchWindowsSelfUpdate();
          logger.warn({ pid: child.pid, url: LATEST_WINDOWS_UPDATE_URL }, "windows update launcher started");
          state.detail = "Actualizador Windows lanzado. Se descargará la última versión y se reiniciará el bot.";
          return;
        }
        const { child, logPath } = launchLinuxSelfUpdate();
        logger.warn({ pid: child.pid, logPath, url: LATEST_LINUX_UPDATE_URL }, "latest update script launched (PM2 respawnará el bot al terminar)");
      } catch (e) {
        logger.error({ err: String(e) }, "no se pudo lanzar el actualizador remoto");
      }
      return;
    }
  } finally {
    commandInFlight = false;
    commandStartedAt = 0;
  }
}


async function handleIncoming(from, body, msgId) {
  try {
    const res = await postBackendJson(
      { action: "incoming", from, message: body, msg_id: msgId || null },
      { label: "incoming" },
    );
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
  return "¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦\n\nPuedes ver el menú actualizado con fotos y precios aquí 👉 https://golosoheladeria.vercel.app/menu\n\nSi quieres pedir por WhatsApp, dime qué producto te provoca y lo vamos armando paso a paso.";
}

// Convierte una respuesta con opciones estructuradas en texto numerado.
// El bot local no usa botones nativos de WhatsApp (poco confiables entre
// clientes y versiones de Business). Si el backend devuelve
// `options` o `buttons` como arreglo, las anexamos como lista numerada
// al final del texto. El cliente puede responder con "1", "2" o el
// título de la opción y el backend lo interpreta como confirmación.
function appendOptionsToReply(text, options) {
  if (typeof text !== "string") return text;
  const opts = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!opts.length) return text;
  const lines = opts
    .map((o, i) => {
      const title = typeof o === "string" ? o : String(o?.title ?? o?.label ?? o?.text ?? "").trim();
      return title ? `${i + 1}) ${title}` : "";
    })
    .filter(Boolean);
  if (!lines.length) return text;
  const base = text.trim();
  return `${base}${base ? "\n\n" : ""}${lines.join("\n")}`;
}

function buildUnresolvedPhoneReply() {
  return "¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦\n\nRecibí tu mensaje, pero WhatsApp no me entregó correctamente tu número de contacto.\n\nPor favor envíanos nuevamente tu mensaje o escríbenos desde el número principal para ayudarte con tu pedido.";
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
    return typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : null;
  } catch (e) {
    const err = String(e);
    state.lastAiError = err;
    logger.warn({ err }, "ai_reply error");
    return null;
  }
}

async function enqueueBackendReply(from, reply, purpose = "chatbot_reply") {
  try {
    const res = await postBackendJson({
      action: "enqueue_reply",
      to: from,
      body: reply,
      purpose,
    }, { label: "enqueue_reply", timeoutMs: 15_000, retries: 1 });
    if (!res.ok || res.data?.error) {
      const err = res.data?.error || res.text || `HTTP ${res.status}`;
      state.lastOutboundError = `No se pudo encolar respuesta: ${err}`;
      logger.warn({ status: res.status, body: res.text, data: res.data }, "enqueue reply failed");
      return false;
    }
    logger.info({ from, id: res.data?.id, deduped: res.data?.deduped }, "reply queued for outbound retry");
    return true;
  } catch (e) {
    state.lastOutboundError = String(e);
    logger.warn({ err: String(e) }, "enqueue reply error");
    return false;
  }
}

async function sendReply(sock, msg, from, reply) {
  if (typeof reply !== "string" || !reply.trim()) return { ok: false, error: "empty_reply" };
  const cleanReply = reply.trim().slice(0, 3900);
  const targets = [];
  const originalJid = msg.key.remoteJid;
  const phone = normalizeOutboundPhone(from);
  const phoneJid = phone ? `${phone}@s.whatsapp.net` : "";
  // En WhatsApp reciente muchos mensajes entran como @lid. Baileys puede aceptar
  // sendMessage(@lid) sin error, pero el cliente no siempre recibe la respuesta.
  // Por eso, cuando tenemos teléfono resuelto, SIEMPRE preferimos @s.whatsapp.net.
  if (phoneJid) targets.push(phoneJid);
  if (originalJid && originalJid !== phoneJid) targets.push(originalJid);
  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  let lastErr = null;
  for (const jid of uniqueTargets) {
    try {
      await withTimeout(sock.sendMessage(jid, { text: cleanReply }), 15_000, "Enviar respuesta por WhatsApp");
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
let outboundStartedAt = 0;
let socketGeneration = 0;
let reconnectTimer = null;
let socketStartInFlight = false;
const incomingQueues = new Map();
const processedMessageIds = new Map();

function pruneProcessedMessageIds(now = Date.now()) {
  for (const [key, seenAt] of processedMessageIds) {
    if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) processedMessageIds.delete(key);
  }
  while (processedMessageIds.size > PROCESSED_MESSAGE_MAX) {
    const oldest = processedMessageIds.keys().next().value;
    if (!oldest) break;
    processedMessageIds.delete(oldest);
  }
}

function shouldProcessMessage(messageKey) {
  const id = String(messageKey?.id || "").trim();
  if (!id) return true;
  const remote = String(messageKey?.remoteJid || "").trim();
  const participant = String(messageKey?.participant || "").trim();
  const key = `${remote}|${participant}|${id}`;
  const now = Date.now();
  pruneProcessedMessageIds(now);
  if (processedMessageIds.has(key)) return false;
  processedMessageIds.set(key, now);
  return true;
}

function scheduleReconnect(delayMs, reason = "reconnect") {
  if (instanceRetired) return;
  if (reconnectTimer) {
    logger.info({ reason }, "reconnect already scheduled");
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSocket().catch((e) => logger.error(e));
  }, Math.max(250, delayMs));
}

function enqueueIncoming(from, task) {
  const previous = incomingQueues.get(from) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => withTimeout(Promise.resolve().then(task), INCOMING_TASK_TIMEOUT_MS, "Procesar mensaje entrante"))
    .catch((e) => {
      logger.warn({ err: String(e), from }, "incoming task failed");
    })
    .finally(() => {
      if (incomingQueues.get(from) === next) incomingQueues.delete(from);
    });
  incomingQueues.set(from, next);
  return next;
}

async function processResolvedIncoming(sock, msg, from, text, audioNode, jid, msgId) {
  logger.info({ from, jid, textLen: text.length, hasAudio: !!audioNode, msgId }, "incoming");
  state.lastIncomingAt = Date.now();
  state.lastIncomingFrom = from;
  state.lastIncomingPreview = text ? text.slice(0, 120) : audioNode ? "[nota de voz]" : "[sin texto]";
  state.lastReplySource = null;
  state.lastReplyError = null;

  // 1) Respuesta fija del POS (bienvenida, menú, fuera de horario…)
  let reply = null;
  let incomingData = null;
  if (text) {
    incomingData = await handleIncoming(from, text, msgId);
    const rawReply = typeof incomingData?.reply === "string" && incomingData.reply.trim() ? incomingData.reply : null;
    const options = Array.isArray(incomingData?.options)
      ? incomingData.options
      : Array.isArray(incomingData?.buttons)
      ? incomingData.buttons
      : null;
    reply = rawReply ? appendOptionsToReply(rawReply, options) : null;
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
        const buf = await withTimeout(
          downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }),
          18_000,
          "Descargar nota de voz",
        );
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
    } else {
      await enqueueBackendReply(from, reply, state.lastReplySource === "ai" ? "chatbot_ai_reply" : "chatbot_reply");
    }
  }
}

function normalizeOutboundPhone(raw) {
  const value = String(raw || "").trim();
  if (value.includes("@lid")) return "";
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `57${digits}`;
  // Heladería Goloso opera con números colombianos. Rechazar otros números
  // evita convertir identificadores anónimos @lid en teléfonos falsos.
  if (!/^57\d{10}$/.test(digits)) return "";
  return digits;
}

function normalizeOutboundTarget(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^[^\s@]+@(s\.whatsapp\.net|lid)$/i.test(value)) return value;
  const phone = normalizeOutboundPhone(value);
  return phone ? `${phone}@s.whatsapp.net` : "";
}

async function reportOutboundPoll(status, count = 0, error = null) {
  try {
    await fetchWithTimeout(`${config.apiUrl}/api/public/whatsapp-bot`, {
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
    }, STATUS_PUSH_TIMEOUT_MS);
  } catch (e) {
    logger.warn({ err: String(e) }, "poll status report failed");
  }
}

async function pollOutbound() {
  if (instanceRetired) return;
  if (!currentSock || state.status !== "connected") return;
  if (outboundInFlight) return;
  outboundInFlight = true;
  outboundStartedAt = Date.now();
  try {
    const res = await fetchWithTimeout(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pending", token: config.token, version: BOT_VERSION }),
    }, OUTBOUND_REQUEST_TIMEOUT_MS);
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
      const jid = normalizeOutboundTarget(item.to);
      if (!jid || !item.body) {
        failed.push(item.id);
        lastErr = !jid
          ? `Destino inválido para WhatsApp: ${String(item.to || "vacío").slice(0, 80)}`
          : "Mensaje saliente vacío";
        logger.warn({ err: lastErr, to: item.to }, "outbound item invalid");
        continue;
      }
      try {
        if (jid.endsWith("@s.whatsapp.net")) {
          const exists = await withTimeout(currentSock.onWhatsApp(jid).catch(() => null), 10_000, "Validar número de WhatsApp");
          if (Array.isArray(exists) && exists.length > 0 && exists[0]?.exists === false) {
            throw new Error(`El número ${jid.replace("@s.whatsapp.net", "")} no aparece activo en WhatsApp`);
          }
        }
        await withTimeout(currentSock.sendMessage(jid, { text: String(item.body) }), 20_000, "Enviar mensaje saliente");
        sent.push(item.id);
        logger.info({ jid }, "outbound sent");
        await new Promise((r) => setTimeout(r, OUTBOUND_DELAY_MIN + Math.random() * (OUTBOUND_DELAY_MAX - OUTBOUND_DELAY_MIN)));
      } catch (e) {
        failed.push(item.id);
        lastErr = String(e);
        logger.warn({ err: lastErr, jid }, "outbound send failed");
      }
    }
    state.lastOutboundError = lastErr;
    await fetchWithTimeout(`${config.apiUrl}/api/public/whatsapp-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ack", token: config.token, sent, failed, error: lastErr, version: BOT_VERSION }),
    }, OUTBOUND_REQUEST_TIMEOUT_MS);
  } catch (e) {
    const message = String(e);
    state.lastOutboundError = message;
    await reportOutboundPoll("error", 0, message);
    logger.warn({ err: message }, "poll outbound error");
  } finally {
    outboundInFlight = false;
    outboundStartedAt = 0;
  }
}

async function startSocket() {
  if (instanceRetired) return null;
  if (socketStartInFlight) return currentSock;
  if (currentSock && state.status === "connected") return currentSock;
  socketStartInFlight = true;
  const generation = ++socketGeneration;
  markConnectionState("connecting");
  state.detail = "Preparando sesión de WhatsApp...";
  console.log("\nConectando con WhatsApp. El QR puede tardar unos segundos...\n");
  try {
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
    if (instanceRetired) {
      try { sock.ws?.close?.(); } catch { /* noop */ }
      return null;
    }
    currentSock = sock;

    sock.ws?.on?.("close", () => {
      if (generation !== socketGeneration || instanceRetired) return;
      markConnectionState("disconnected");
      state.detail = "El WebSocket de WhatsApp se cerró. Reconectando automáticamente...";
      if (currentSock === sock) currentSock = null;
      pushStatus();
      scheduleReconnect(2000, "websocket_close");
    });

    sock.ws?.on?.("error", (error) => {
      if (generation !== socketGeneration || instanceRetired) return;
      state.lastError = `WebSocket WhatsApp: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn({ err: state.lastError }, "whatsapp websocket error");
    });

  sock.ev.on("creds.update", async (...args) => {
    if (generation !== socketGeneration) return;
    markBaileysEvent("creds.update");
    await saveCreds(...args);
    if (state.status === "connected" || state.phone) backupAuthState("creds.update");
  });

  sock.ev.on("connection.update", async (update) => {
    if (generation !== socketGeneration) return;
    markBaileysEvent("connection.update");
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      markConnectionState("qr");
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
      markConnectionState("connected");
      state.qr = null;
      state.qrDataUrl = null;
      state.phone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      state.detail = "Conectado correctamente.";
      state.lastError = null;
      clearLoggedOutRecovery();
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
        markConnectionState("connecting");
        state.detail = "Reconexión pausada brevemente mientras se repara la sesión cifrada. Se reintentará automáticamente.";
        pushStatus();
        scheduleReconnect(waitMs, "signal_repair_pause");
        return;
      }
      if (!shouldReconnect) {
        await startFreshPairingAfterLogout("WhatsApp reportó cierre de sesión y no hubo copia válida para restaurar");
        return;
      }
      markConnectionState("connecting");
      state.qr = null;
      state.qrDataUrl = null;
      state.detail = "WhatsApp cerró la conexión momentáneamente. Reconectando automáticamente...";
      if (currentSock === sock) currentSock = null;
      pushStatus();
      scheduleReconnect(5000, "connection_close");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (generation !== socketGeneration) return;
    markBaileysEvent("messages.upsert");
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (!shouldProcessMessage(msg.key)) {
        logger.info({ messageId: msg.key.id, jid: msg.key.remoteJid }, "duplicate incoming message ignored");
        continue;
      }
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
        if (val.includes("@lid")) return "";
        const raw = val.split("@")[0].split(":")[0];
        if (raw.length === 10) return `57${raw}`;
        return /^57\d{10}$/.test(raw) ? raw : "";
      };
      let phoneSource = "";
      const candidates = [
        !jid.endsWith("@lid") ? jid : "",
        msg.key.remoteJidAlt,
        msg.key.senderPn,
        msg.key.participantPn,
        msg.key.participantAlt,
        msg.key.participant,
      ];
      for (const c of candidates) {
        phoneSource = extractPhone(c);
        if (phoneSource) break;
      }
      const from = phoneSource || jid;
      if (!phoneSource || !/^\d{6,}$/.test(phoneSource)) {
        state.unresolvedPhoneCount = (state.unresolvedPhoneCount || 0) + 1;
        state.lastUnresolvedJid = jid;
        state.lastUnresolvedAt = Date.now();
        state.lastIncomingAt = Date.now();
        state.lastIncomingFrom = jid || "jid_unresolved";
        state.lastIncomingPreview = text ? text.slice(0, 120) : audioNode ? "[nota de voz]" : "[sin texto]";
        logger.warn(
          {
            jid,
            remoteJidAlt: msg.key.remoteJidAlt,
            senderPn: msg.key.senderPn,
            participantPn: msg.key.participantPn,
            participantAlt: msg.key.participantAlt,
            participant: msg.key.participant,
          },
          "phone_unresolved — se procesará con JID anónimo para no perder la conversación",
        );
      }
      const localMsgId = msg.key.id || "";
      await enqueueIncoming(from, () => processResolvedIncoming(sock, msg, from, text, audioNode, jid, localMsgId));
    }
  });

    return sock;
  } finally {
    socketStartInFlight = false;
  }
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
      res.end(JSON.stringify({ version: BOT_VERSION, status: state.status, phone: state.phone, detail: state.detail, lastError: state.lastError, lastPushAt: state.lastPushAt, lastPushError: state.lastPushError, lastIncomingAt: state.lastIncomingAt, lastIncomingFrom: state.lastIncomingFrom, lastIncomingPreview: state.lastIncomingPreview, lastReplyAt: state.lastReplyAt, lastReplySource: state.lastReplySource, lastReplyError: state.lastReplyError, lastAiError: state.lastAiError, lastConversationId: state.lastConversationId, lastBackendLatencyMs: state.lastBackendLatencyMs, unresolvedPhoneCount: state.unresolvedPhoneCount, lastUnresolvedJid: state.lastUnresolvedJid, lastUnresolvedAt: state.lastUnresolvedAt, lastBaileysEventAt: state.lastBaileysEventAt, lastBaileysEvent: state.lastBaileysEvent, instanceId: INSTANCE_ID, instanceRetired, hasQr: Boolean(state.qr), hasAuthState: hasUsableAuthState(AUTH_DIR), authDir: AUTH_DIR, legacyAuthDir: LEGACY_AUTH_DIR, port: activeLocalPort, folder: __dirname }));
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
  if (!acquireInstanceLock()) {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await wait(5_000);
      if (acquireInstanceLock()) break;
      logger.warn({ attempt }, "duplicate lock still active; waiting before exit");
    }
    if (!readInstanceLock() || readInstanceLock()?.instanceId !== INSTANCE_ID) {
      logger.error("No se pudo tomar el candado local; saliendo para que PM2 intente de nuevo después");
      process.exit(1);
    }
  }
  console.log(`\n🍨 Goloso WhatsApp Bot`);
  console.log(`   Versión : ${BOT_VERSION}`);
  console.log(`   Carpeta : ${__dirname}`);
  console.log(`   API POS : ${config.apiUrl}`);
  console.log(`   Token   : ${config.token.slice(0, 6)}…${config.token.slice(-4)}`);
  startLocalUI();
  setInterval(pushStatus, HEARTBEAT_MS);
  setInterval(pollOutbound, OUTBOUND_POLL_MS);
  void pushStatus();
  setTimeout(() => { void checkOfficialBotVersionOnStartup(); }, 8_000);
  setInterval(() => { void checkOfficialBotVersionOnStartup(); }, 6 * 60 * 60 * 1000);

  // ---- Watchdog: auto-reinicio si el bot queda "pegado" ----
  // pm2 (o systemd/nssm) volverá a levantar el proceso al hacer exit(1).
  setInterval(() => {
    const now = Date.now();
    if (state.status === "connected") {
      notConnectedSince = null;
      if (!connectedSince) connectedSince = now;
    } else {
      connectedSince = null;
      if (!notConnectedSince) notConnectedSince = now;
    }

    const stuckMs = notConnectedSince ? now - notConnectedSince : 0;
    if ((state.status === "disconnected" || state.status === "connecting" || state.status === "error" || state.status === "qr")
        && stuckMs > WATCHDOG_MAX_DISCONNECTED_MS) {
      console.error(`\n⚠️  Watchdog: sin conexión estable hace ${Math.round(stuckMs / 1000)}s. Reiniciando…\n`);
      forceProcessRestart("Sin conexión estable por más de 3 minutos", { status: state.status, stuckMs });
      return;
    }
    const wsReadyState = currentSock?.ws?.readyState;
    if (outboundInFlight && outboundStartedAt && now - outboundStartedAt > 2 * 60_000) {
      logger.warn({ outboundStartedAt }, "watchdog: outbound poll pegado; liberando candado");
      outboundInFlight = false;
      outboundStartedAt = 0;
      state.lastOutboundError = "Se liberó automáticamente una revisión de cola que quedó pegada.";
    }
    if (commandInFlight && commandStartedAt && now - commandStartedAt > 2 * 60_000) {
      logger.warn({ commandStartedAt }, "watchdog: comando remoto pegado; liberando candado");
      commandInFlight = false;
      commandStartedAt = 0;
      state.lastError = "Se liberó automáticamente un comando remoto que quedó pegado.";
    }
    if (state.status === "connected" && connectedSince && now - connectedSince > WATCHDOG_MAX_OUTBOUND_STALE_MS) {
      const lastPollAge = state.lastOutboundPollAt ? now - state.lastOutboundPollAt : Number.POSITIVE_INFINITY;
      if (lastPollAge > WATCHDOG_MAX_OUTBOUND_STALE_MS) {
        forceProcessRestart("Conectado a WhatsApp, pero la revisión de cola quedó detenida", {
          lastOutboundPollAt: state.lastOutboundPollAt,
          lastPollAge,
          connectedSince,
        });
        return;
      }
    }
    if (state.status === "connected" && typeof wsReadyState === "number" && wsReadyState !== 1) {
      logger.warn({ readyState: wsReadyState, lastBaileysEventAt }, "watchdog: websocket cerrado pese a estado connected; reconectando");
      try { currentSock.ws?.close?.(); } catch { /* noop */ }
      currentSock = null;
      markConnectionState("connecting");
      state.detail = "Se detectó la conexión interna cerrada. Reconectando automáticamente sin borrar el QR.";
      pushStatus();
      scheduleReconnect(1500, "watchdog_closed_ws");
    }
    if (state.status === "connected" && now - lastBaileysEventAt > 15 * 60_000) {
      logger.warn({ lastBaileysEventAt }, "watchdog: WhatsApp conectado pero sin eventos recientes; reconectando preventivamente");
      try { currentSock?.ws?.close?.(); } catch { /* noop */ }
      currentSock = null;
      markConnectionState("connecting");
      state.detail = "Reconectando automáticamente para mantener la recepción de mensajes activa.";
      pushStatus();
      scheduleReconnect(1500, "watchdog_stale_baileys_events");
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
    markConnectionState("error");
    state.lastError = String(e);
    pushStatus();
  });
}

main();
