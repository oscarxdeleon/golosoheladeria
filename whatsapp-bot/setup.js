/**
 * Setup interactivo: pide el token de la sede y guarda config.json.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const DEFAULT_API = "https://golosoheladeria.lovable.app";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function normalizeApiUrl(value) {
  return String(value || DEFAULT_API).trim().replace(/\/+$/, "");
}

async function validateToken(token, apiUrl) {
  const res = await fetch(`${apiUrl}/api/public/whatsapp-bot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "config", token }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok || data?.error) {
    const detail = data?.error || data?.detail || text || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return data;
}

(async () => {
  console.log("\n=== Goloso WhatsApp Bot — configuración ===\n");
  const existing = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : {};

  const token = (await ask(`Token de la sede${existing.token ? ` [actual: ${existing.token.slice(0, 6)}…]` : ""}: `)).trim() || existing.token;
  if (!token || token.length < 16) {
    console.error("Token inválido. Cópialo desde el panel WhatsApp Bot en el POS.");
    process.exit(1);
  }

  const apiUrl = normalizeApiUrl((await ask(`URL del POS [${existing.apiUrl || DEFAULT_API}]: `)).trim() || existing.apiUrl || DEFAULT_API);

  console.log("\nValidando token con el POS...");
  try {
    const remote = await validateToken(token, apiUrl);
    console.log(`✅ Token válido para sede: ${remote.branch_name || remote.branch_id || "Goloso"}`);
  } catch (error) {
    console.error("\n[ERROR] No se pudo validar el token con el POS.");
    console.error(`Detalle: ${error instanceof Error ? error.message : String(error)}`);
    console.error("\nCopia nuevamente el token exacto desde Ajustes → WhatsApp Bot y revisa que la URL del POS sea correcta.");
    process.exit(1);
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token, apiUrl }, null, 2));
  console.log(`\n✅ Guardado en ${CONFIG_PATH}\n`);
  rl.close();
})();
