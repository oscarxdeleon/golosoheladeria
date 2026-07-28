import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { execSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "Golosito Bot";
const API_URL = "https://golosoheladeria.lovable.app";
const BUILD_DATE = "2026-07-28";
const STARTUP_METHOD = "golosito-one-click-v1";
const LOCAL_PORTS = Array.from({ length: 21 }, (_, i) => 8790 + i);
const args = process.argv.slice(2);

const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
};

const TOKEN = argValue("--token");
const EXPECTED = argValue("--expected") || packageVersion(SOURCE_DIR) || serverVersion(SOURCE_DIR);
const MAX_ATTEMPTS = 3;

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), "AppData", "Local");
}

function roamingAppData() {
  return process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), "AppData", "Roaming");
}

const ROOT = path.join(localAppData(), "GolositoBot");
const RUNTIME_DIR = path.join(ROOT, "app");
const LOG_DIR = path.join(ROOT, "logs");
const DATA_ROOT = path.join(roamingAppData(), "GolositoBot");
const LOG_PATH = path.join(LOG_DIR, `install-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(LOG_DIR);

function log(message, detail = undefined) {
  const suffix = detail === undefined ? "" : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}${suffix}\n`, "utf8");
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeJson(p, value) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function real(p) {
  try { return p && exists(p) ? fs.realpathSync(p) : ""; } catch { return ""; }
}

function norm(p) {
  return real(p).toLowerCase();
}

function packageVersion(folder) {
  return String(readJson(path.join(folder, "package.json"))?.version || "").trim();
}

function serverVersion(folder) {
  return readText(path.join(folder, "server.js")).match(/BOT_VERSION\s*=\s*["']([^"']+)["']/)?.[1]?.trim() || "";
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "default")).digest("hex").slice(0, 18);
}

function tokenFromFolder(folder) {
  return String(readJson(path.join(folder, "config.json"))?.token || "").trim();
}

function sessionDir(token) {
  return path.join(DATA_ROOT, "sessions", `sede-${hashToken(token)}`);
}

function hasAuth(dir) {
  return Boolean(dir) && exists(path.join(dir, "creds.json"));
}

function copyDir(src, dest) {
  if (!exists(src)) return;
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function removePath(target) {
  if (!target || !exists(target)) return;
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}

function emptyDir(target) {
  removePath(target);
  ensureDir(target);
}

function powershell(script, { capture = false } = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    windowsHide: true,
  });
  if (capture) return `${result.stdout || ""}${result.stderr || ""}`;
  return "";
}

function commonRoots() {
  const user = process.env.USERPROFILE || os.homedir();
  return [
    ROOT,
    path.join(localAppData(), "GolosoBotRuntime"),
    path.join(localAppData(), "Goloso WhatsApp Bot"),
    path.join(roamingAppData(), "Goloso WhatsApp Bot"),
    path.join(user, "Goloso WhatsApp Bot"),
    path.join(user, "GolosoBot"),
    "C:\\GolosoBot",
    "C:\\Goloso WhatsApp Bot",
  ].filter(Boolean);
}

function processRows() {
  const ps = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'node.exe|wscript.exe|cmd.exe|powershell.exe') -and ($_.CommandLine -match 'goloso|golosito|whatsapp|server\\.js|update-windows|goloso-bot-launcher') } | ForEach-Object { ([string]$_.ProcessId) + '|' + ([string]$_.Name) + '|' + ([string]$_.CommandLine) }";
  return powershell(ps, { capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, name, ...rest] = line.split("|");
      return { pid, name, command: rest.join("|") };
    })
    .filter((row) => /^\d+$/.test(row.pid) && row.pid !== String(process.pid));
}

function folderFromCommand(command) {
  const match = String(command || "").match(/([A-Z]:\\[^\r\n"']*?server\.js)/i);
  return match ? path.dirname(match[1]) : "";
}

function activeStatusFolders() {
  const folders = [];
  for (const port of LOCAL_PORTS) {
    try {
      const body = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $s=Invoke-RestMethod -UseBasicParsing -Uri 'http://localhost:${port}/status.json' -TimeoutSec 1; if($s.folder){ $s.folder } } catch {}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (body) folders.push(body);
    } catch { /* noop */ }
  }
  return folders;
}

function startupTargets() {
  const ps = [
    "$items=@()",
    "$paths=@([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup')) | Where-Object { $_ }",
    "$ws=New-Object -ComObject WScript.Shell",
    "foreach($p in $paths){ if(Test-Path $p){ Get-ChildItem -LiteralPath $p -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object { try { $s=$ws.CreateShortcut($_.FullName); $items += ($s.TargetPath+' '+$s.Arguments+' '+$s.WorkingDirectory) } catch {} } } }",
    "$runs=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')",
    "foreach($run in $runs){ if(Test-Path $run){ Get-ItemProperty -Path $run | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' } | ForEach-Object { $items += [string]$_.Value } } } }",
    "$items | Where-Object { $_ -match 'goloso|golosito|whatsapp|server\\.js|start-hidden|launcher' }",
  ].join("; ");
  return powershell(ps, { capture: true }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function findCandidateFolders() {
  const folders = new Set();
  for (const folder of activeStatusFolders()) folders.add(real(folder));
  for (const row of processRows()) {
    const folder = folderFromCommand(row.command);
    if (folder) folders.add(real(folder));
  }
  for (const blob of startupTargets()) {
    const server = blob.match(/([A-Z]:\\[^\r\n"']*?server\.js)/i);
    const app = blob.match(/([A-Z]:\\[^\r\n"']*?(?:GolosoBotRuntime|Goloso WhatsApp Bot|GolositoBot|whatsapp-bot)[^\r\n"']*)/i);
    if (server) folders.add(real(path.dirname(server[1])));
    if (app) folders.add(real(app[1]));
  }
  for (const root of commonRoots()) if (exists(root)) folders.add(real(root));
  return [...folders].filter(Boolean).filter((folder) => norm(folder) !== norm(SOURCE_DIR));
}

function discoverToken() {
  if (TOKEN) return TOKEN;
  for (const folder of findCandidateFolders()) {
    const token = tokenFromFolder(folder);
    if (token) return token;
  }
  const sourceToken = tokenFromFolder(SOURCE_DIR);
  if (sourceToken) return sourceToken;
  throw new Error("No se encontró token de sede. Descarga el instalador desde el botón del POS para que quede configurado automáticamente.");
}

function backupAuth(token) {
  const fingerprint = hashToken(token);
  const backup = path.join(DATA_ROOT, "install-backups", fingerprint, new Date().toISOString().replace(/[:.]/g, "-"));
  ensureDir(backup);
  const candidates = [
    sessionDir(token),
    path.join(roamingAppData(), "Goloso WhatsApp Bot", "sessions", `sede-${fingerprint}`),
    ...findCandidateFolders().map((folder) => path.join(folder, "auth_state")),
  ];
  const unique = [...new Set(candidates.map(real).filter(Boolean))];
  for (const dir of unique) {
    if (!hasAuth(dir)) continue;
    const dest = path.join(backup, "auth_state");
    copyDir(dir, dest);
    log("Credenciales WhatsApp respaldadas", { from: dir, to: dest });
    return dest;
  }
  return "";
}

function stopEverything() {
  log("Cerrando procesos relacionados");
  for (const row of processRows()) {
    spawnSync("taskkill", ["/F", "/PID", row.pid, "/T"], { shell: true, stdio: "ignore" });
  }
  try {
    const netstat = execSync("netstat -ano", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of netstat.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      if (!LOCAL_PORTS.some((port) => line.includes(`:${port}`))) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (/^\d+$/.test(String(pid)) && pid !== String(process.pid)) {
        spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"], { shell: true, stdio: "ignore" });
      }
    }
  } catch { /* noop */ }
}

function cleanupWindowsEntrypoints() {
  const escapedRoot = ROOT.replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$newRoot='${escapedRoot}'`,
    "$startupPaths=@([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup')) | Where-Object { $_ }",
    "$ws=New-Object -ComObject WScript.Shell",
    "foreach($startup in $startupPaths){ if(Test-Path $startup){ Get-ChildItem -LiteralPath $startup -Filter '*.lnk' | ForEach-Object { $delete=$false; try { $s=$ws.CreateShortcut($_.FullName); $blob=($_.Name+' '+$s.TargetPath+' '+$s.Arguments+' '+$s.WorkingDirectory).ToLowerInvariant(); if($blob -match 'goloso|golosito|whatsapp|server\\.js|start-hidden|launcher|golosobotruntime'){ $delete=$true } } catch { if($_.Name -match 'Goloso|Golosito|WhatsApp'){ $delete=$true } }; if($delete){ Remove-Item -LiteralPath $_.FullName -Force } } } }",
    "$runs=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')",
    "foreach($run in $runs){ if(Test-Path $run){ Get-ItemProperty -Path $run | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' } | ForEach-Object { $name=$_.Name; $value=[string]$_.Value; if(($name+' '+$value) -match 'Goloso|Golosito|WhatsApp|server\\.js|start-hidden|launcher|GolosoBotRuntime'){ Remove-ItemProperty -Path $run -Name $name -Force } } } } }",
    "Get-ScheduledTask | Where-Object { ($_.TaskName -match 'Goloso|Golosito|WhatsApp') -or (($_.Actions | Out-String) -match 'Goloso|Golosito|WhatsApp|server\\.js|start-hidden|launcher|GolosoBotRuntime') } | Unregister-ScheduledTask -Confirm:$false",
    "$tempRoots=@($env:TEMP,$env:TMP,(Join-Path $env:LOCALAPPDATA 'Temp')) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique",
    "foreach($t in $tempRoots){ Get-ChildItem -LiteralPath $t -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'goloso|golosito|whatsapp-bot|electron-updater|squirrel' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }",
    "$caches=@((Join-Path $env:LOCALAPPDATA 'GolosoBotRuntime'),(Join-Path $env:LOCALAPPDATA 'Goloso WhatsApp Bot'),(Join-Path $env:LOCALAPPDATA 'electron-updater'),(Join-Path $env:APPDATA 'electron-updater'),(Join-Path $env:LOCALAPPDATA 'SquirrelTemp'))",
    "foreach($c in $caches){ if($c -and (Test-Path $c)){ Remove-Item -LiteralPath $c -Recurse -Force -ErrorAction SilentlyContinue } }",
  ].join("; ");
  powershell(ps);
}

function removeOldFolders() {
  for (const folder of findCandidateFolders()) {
    const normalized = norm(folder);
    if (!normalized || normalized === norm(SOURCE_DIR) || normalized === norm(RUNTIME_DIR)) continue;
    if (!/goloso|golosito|whatsapp/i.test(folder)) continue;
    try {
      removePath(folder);
      log("Carpeta anterior eliminada", folder);
    } catch (error) {
      log("No se pudo eliminar carpeta anterior", { folder, error: String(error?.message || error) });
    }
  }
  emptyDir(RUNTIME_DIR);
}

function copyRuntimeFiles() {
  const files = [
    "server.js",
    "setup.js",
    "package.json",
    "package-lock.json",
    "README.md",
    "goloso-bot-installer.js",
    "uninstall-windows.bat",
  ];
  for (const file of files) {
    const src = path.join(SOURCE_DIR, file);
    if (exists(src)) fs.copyFileSync(src, path.join(RUNTIME_DIR, file));
  }
}

function ensureDependencies() {
  if (exists(path.join(RUNTIME_DIR, "node_modules", "@whiskeysockets", "baileys"))) return;
  const sourceModules = path.join(SOURCE_DIR, "node_modules");
  if (exists(path.join(sourceModules, "@whiskeysockets", "baileys"))) {
    copyDir(sourceModules, path.join(RUNTIME_DIR, "node_modules"));
    return;
  }
  const result = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: RUNTIME_DIR,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  log("npm install", { status: result.status, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error("No se pudieron instalar dependencias del bot");
}

function writeStartup(token) {
  const authDir = sessionDir(token);
  ensureDir(authDir);
  const vbsPath = path.join(RUNTIME_DIR, "start-hidden.vbs");
  const outLog = path.join(LOG_DIR, "bot-out.log");
  const vbsString = (value) => String(value).replace(/"/g, '""');
  const escapedRuntime = vbsString(RUNTIME_DIR);
  const escapedData = vbsString(DATA_ROOT);
  const escapedAuth = vbsString(authDir);
  const escapedOut = vbsString(outLog);
  const body = [
    `' ${STARTUP_METHOD}`,
    `' version=${EXPECTED}`,
    "Set WshShell = CreateObject(\"WScript.Shell\")",
    `WshShell.CurrentDirectory = "${escapedRuntime}"`,
    `WshShell.Environment("PROCESS")("GOLOSO_BOT_DATA_DIR") = "${escapedData}"`,
    `WshShell.Environment("PROCESS")("GOLOSO_BOT_SESSION_DIR") = "${escapedAuth}"`,
    `WshShell.Environment("PROCESS")("GOLOSO_BOT_STARTUP_VERSION") = "${EXPECTED}"`,
    `WshShell.Environment("PROCESS")("GOLOSO_BOT_BUILD_DATE") = "${BUILD_DATE}"`,
    `WshShell.Run "cmd /c node server.js >> ""${escapedOut}"" 2>&1", 0, False`,
  ].join("\r\n");
  fs.writeFileSync(vbsPath, body, "utf8");
  return { vbsPath, authDir };
}

function registerStartup(vbsPath) {
  const startupDir = path.join(roamingAppData(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  ensureDir(startupDir);
  const shortcutPath = path.join(startupDir, "Golosito Bot.lnk");
  const shortcutScript = path.join(os.tmpdir(), `golosito-shortcut-${Date.now()}.vbs`);
  fs.writeFileSync(shortcutScript, [
    "Set ws = WScript.CreateObject(\"WScript.Shell\")",
    `Set s = ws.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")`,
    "s.TargetPath = \"wscript.exe\"",
    `s.Arguments = Chr(34) & "${vbsPath.replace(/\\/g, "\\\\")}" & Chr(34)`,
    `s.WorkingDirectory = "${RUNTIME_DIR.replace(/\\/g, "\\\\")}"`,
    "s.WindowStyle = 7",
    "s.Description = \"Golosito Bot\"",
    "s.Save",
  ].join("\r\n"), "utf8");
  spawnSync("cscript", ["//nologo", shortcutScript], { shell: true, stdio: "ignore" });
  removePath(shortcutScript);
  spawnSync("reg", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "GolositoBot", "/t", "REG_SZ", "/d", `wscript.exe "${vbsPath}"`, "/f"], { stdio: "ignore" });
  spawnSync("schtasks", ["/Create", "/SC", "ONLOGON", "/TN", "GolositoBot", "/TR", `wscript.exe "${vbsPath}"`, "/F"], { shell: true, stdio: "ignore" });
}

function installFiles(token, authBackup) {
  ensureDir(RUNTIME_DIR);
  copyRuntimeFiles();
  writeJson(path.join(RUNTIME_DIR, "config.json"), { token, apiUrl: API_URL });
  const { vbsPath, authDir } = writeStartup(token);
  if (authBackup && hasAuth(authBackup)) copyDir(authBackup, authDir);
  ensureDependencies();
  writeJson(path.join(RUNTIME_DIR, "installation.json"), {
    app: APP_NAME,
    method: STARTUP_METHOD,
    version: EXPECTED,
    installedAt: new Date().toISOString(),
    buildDate: BUILD_DATE,
    runtimeDir: RUNTIME_DIR,
    dataRoot: DATA_ROOT,
    authDir,
    startupScript: vbsPath,
    installerLog: LOG_PATH,
  });
  registerStartup(vbsPath);
  return { vbsPath, authDir };
}

function readStartupVersion(vbsPath) {
  return readText(vbsPath).match(/version=([^\r\n]+)/)?.[1]?.trim() || "";
}

function fetchStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/status.json", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function startBot(vbsPath) {
  spawn("wscript.exe", ["//nologo", vbsPath], { cwd: RUNTIME_DIR, detached: true, stdio: "ignore" }).unref();
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    for (const port of LOCAL_PORTS) {
      const status = await fetchStatus(port);
      if (status?.version) return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

function commandLineForPid(pid) {
  if (!pid) return "";
  const ps = `try { (Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine } catch {}`;
  return powershell(ps, { capture: true }).trim();
}

async function validateInstall(vbsPath) {
  const checks = {
    expected: EXPECTED,
    packageJson: packageVersion(RUNTIME_DIR),
    serverJs: serverVersion(RUNTIME_DIR),
    installationJson: readJson(path.join(RUNTIME_DIR, "installation.json"))?.version || "",
    startupScript: readStartupVersion(vbsPath),
    buildDate: readJson(path.join(RUNTIME_DIR, "installation.json"))?.buildDate || "",
    folder: real(RUNTIME_DIR),
  };
  for (const [key, value] of Object.entries(checks)) {
    if (["expected", "folder"].includes(key)) continue;
    if (String(value) !== String(EXPECTED) && key !== "buildDate") throw new Error(`Validación fallida ${key}: ${value}`);
  }
  if (checks.buildDate !== BUILD_DATE) throw new Error(`Validación fallida buildDate: ${checks.buildDate}`);

  startBot(vbsPath);
  const status = await waitForStatus();
  if (!status) throw new Error("El bot nuevo no inició panel local");
  const commandLine = commandLineForPid(status.pid);
  const runtime = norm(RUNTIME_DIR);
  const statusFolder = norm(String(status.folder || ""));
  const runtimeInCommand = commandLine.toLowerCase().includes(runtime);
  const serverPathInCommand = commandLine.toLowerCase().includes(path.join(runtime, "server.js"));
  const liveChecks = {
    runningVersion: status.version,
    runningPackage: status.packageVersion,
    runningServer: status.serverVersion,
    runningStartup: status.startupVersion,
    runningBuild: status.buildDate,
    pid: status.pid,
    execPath: status.execPath,
    runningFolder: status.folder,
    commandLine,
  };
  log("Validación en memoria", liveChecks);
  if (String(status.version) !== EXPECTED) throw new Error(`Versión en ejecución inválida: ${status.version}`);
  if (String(status.packageVersion) !== EXPECTED) throw new Error(`package en memoria inválido: ${status.packageVersion}`);
  if (String(status.serverVersion) !== EXPECTED) throw new Error(`server en memoria inválido: ${status.serverVersion}`);
  if (String(status.startupVersion) !== EXPECTED) throw new Error(`startup en memoria inválido: ${status.startupVersion}`);
  if (String(status.buildDate) !== BUILD_DATE) throw new Error(`build en memoria inválido: ${status.buildDate}`);
  if (statusFolder !== runtime) throw new Error(`Carpeta en memoria inválida: ${status.folder}`);
  if (!status.pid || !String(status.execPath || "").toLowerCase().includes("node")) throw new Error("PID/ejecutable inválido");
  if (!runtimeInCommand && !serverPathInCommand) throw new Error("El proceso activo no apunta al runtime nuevo");
  return { ...checks, ...liveChecks };
}

async function attemptInstall(token, authBackup, attempt) {
  log(`Intento ${attempt}: cerrar versión anterior`);
  stopEverything();
  log(`Intento ${attempt}: limpiar entradas y archivos antiguos`);
  cleanupWindowsEntrypoints();
  removeOldFolders();
  log(`Intento ${attempt}: instalar runtime nuevo`);
  const { vbsPath } = installFiles(token, authBackup);
  log(`Intento ${attempt}: verificar instalación`);
  const validation = await validateInstall(vbsPath);
  writeJson(path.join(RUNTIME_DIR, "last-validation.json"), validation);
}

async function main() {
  if (process.platform !== "win32") throw new Error("Este instalador es exclusivo para Windows");
  if (!EXPECTED) throw new Error("El paquete no tiene versión válida");
  if (packageVersion(SOURCE_DIR) !== EXPECTED || serverVersion(SOURCE_DIR) !== EXPECTED) {
    throw new Error(`Paquete inconsistente package=${packageVersion(SOURCE_DIR)} server=${serverVersion(SOURCE_DIR)} expected=${EXPECTED}`);
  }
  const token = discoverToken();
  const authBackup = backupAuth(token);
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await attemptInstall(token, authBackup, attempt);
      log("Instalación completada correctamente", { runtime: RUNTIME_DIR, version: EXPECTED });
      return;
    } catch (error) {
      lastError = error;
      log(`Intento ${attempt} falló`, String(error?.stack || error?.message || error));
      stopEverything();
      try { removePath(RUNTIME_DIR); } catch { /* noop */ }
    }
  }
  throw lastError || new Error("No fue posible completar la instalación");
}

main().catch((error) => {
  log("ERROR FINAL", String(error?.stack || error?.message || error));
  process.exit(1);
});