/**
 * Setup interactivo: pide el token de la sede y guarda config.json.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const SETUP_OK_PATH = path.join(__dirname, ".setup-ok");
const DEFAULT_API = "https://golosoheladeria.lovable.app";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function normalizeApiUrl(value) {
  return String(value || DEFAULT_API).trim().replace(/\/+$/, "");
}

function postJson(apiUrl, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL("/api/public/whatsapp-bot", apiUrl);
    const body = JSON.stringify(payload);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "GolosoWhatsAppBot/1.0",
      },
      timeout: 15000,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("La conexión con el POS tardó más de 15s")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function validateToken(token, apiUrl) {
  const res = await postJson(apiUrl, { action: "config", token });
  if (!res.ok || res.data?.error) {
    const detail = res.data?.error === "not_found"
      ? "token_no_encontrado: copia el token completo desde el POS o pulsa Regenerar token y copia el nuevo"
      : (res.data?.error || res.data?.detail || res.text || `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  return res.data;
}

(async () => {
  console.log("\n=== Goloso WhatsApp Bot — configuración ===\n");
  const existing = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : {};

  const token = (await ask(`Token de la sede${existing.token ? ` [actual: ${existing.token.slice(0, 6)}…]` : ""}: `)).trim() || existing.token;
  if (!token || token.length < 16) {
    console.error("Token inválido. Cópialo desde el panel WhatsApp Bot en el POS.");
    rl.close();
    process.exitCode = 1;
    return;
  }

  const apiUrl = normalizeApiUrl(process.env.GOLOSO_POS_URL || existing.apiUrl || DEFAULT_API);
  console.log(`URL del POS: ${apiUrl}`);

  console.log("\nValidando token con el POS...");
  try {
    const remote = await validateToken(token, apiUrl);
    console.log(`✅ Token válido para sede: ${remote.branch_name || remote.branch_id || "Goloso"}`);
    const canonicalToken = remote.device_token || token;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token: canonicalToken, apiUrl }, null, 2));
    fs.writeFileSync(SETUP_OK_PATH, new Date().toISOString());
    console.log(`\n✅ Guardado en ${CONFIG_PATH}\n`);
  } catch (error) {
    console.error("\n[ERROR] No se pudo validar el token con el POS.");
    console.error(`Detalle: ${error instanceof Error ? error.message : String(error)}`);
    console.error("\nCopia nuevamente el token exacto desde Ajustes → WhatsApp Bot. Si persiste, pulsa Regenerar token y usa el nuevo.");
    rl.close();
    process.exitCode = 1;
    return;
  }

  rl.close();
})();
