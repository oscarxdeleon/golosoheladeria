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

(async () => {
  console.log("\n=== Goloso WhatsApp Bot — configuración ===\n");
  const existing = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : {};

  const token = (await ask(`Token de la sede${existing.token ? ` [actual: ${existing.token.slice(0, 6)}…]` : ""}: `)).trim() || existing.token;
  if (!token || token.length < 16) {
    console.error("Token inválido. Cópialo desde el panel WhatsApp Bot en el POS.");
    process.exit(1);
  }

  const apiUrl = (await ask(`URL del POS [${existing.apiUrl || DEFAULT_API}]: `)).trim() || existing.apiUrl || DEFAULT_API;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token, apiUrl }, null, 2));
  console.log(`\n✅ Guardado en ${CONFIG_PATH}\n`);
  rl.close();
})();
