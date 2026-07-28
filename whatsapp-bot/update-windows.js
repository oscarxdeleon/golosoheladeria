import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_URL = 'https://golosoheladeria.lovable.app';
const APP_NAME = 'Goloso WhatsApp Bot';
const INSTALL_ROOT_NAME = 'GolosoBotRuntime';
const STARTUP_LINK_NAME = 'Goloso WhatsApp Bot.lnk';
const RUN_VALUE_NAME = 'GolosoWhatsAppBot';
const LOCAL_PORTS = Array.from({ length: 21 }, (_, index) => 8790 + index);
const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);
const getValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
};

const force = hasFlag('--force');
const autoFromInstaller = hasFlag('--auto-from-installer');
let targetPath = getValue('--target').trim().replace(/^['"]+|['"]+$/g, '');

function step(text) {
  console.log('');
  console.log(`== ${text} ==`);
}

function exists(filePath) {
  try { return fs.existsSync(filePath); } catch { return false; }
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveFolder(folder) {
  try { return folder && exists(folder) ? fs.realpathSync(folder) : ''; } catch { return ''; }
}

function normalizeForCompare(folder) {
  return resolveFolder(folder).toLowerCase();
}

function addCandidate(set, folder) {
  const resolved = resolveFolder(folder);
  if (resolved) set.add(resolved);
}

function isBackupOrTempFolderName(name) {
  return /^backup-before-update/i.test(name)
    || /^goloso-bot-update-/i.test(name)
    || /^goloso-clean-install-/i.test(name)
    || /^extract$/i.test(name)
    || /^pkg$/i.test(name)
    || /^node_modules$/i.test(name)
    || /^session-backups$/i.test(name)
    || /^sessions$/i.test(name)
    || /^session-meta$/i.test(name)
    || /^cache$/i.test(name)
    || /^caches$/i.test(name)
    || /^temp$/i.test(name)
    || /^tmp$/i.test(name);
}

function isBotFolder(folder) {
  if (!folder || !exists(folder)) return false;
  const hasConfig = exists(path.join(folder, 'config.json'));
  const hasAuth = exists(path.join(folder, 'auth_state')) || hasUsableAuthState(path.join(folder, 'auth_state'));
  const hasCode = exists(path.join(folder, 'server.js')) || exists(path.join(folder, 'package.json')) || exists(path.join(folder, 'start-hidden.vbs'));
  return hasCode && (hasConfig || hasAuth || /goloso|whatsapp|bot/i.test(folder));
}

function readConfig(folder) {
  const cfg = readJson(path.join(folder, 'config.json'));
  return cfg && typeof cfg === 'object' ? cfg : null;
}

function readPackageVersion(folder) {
  return String(readJson(path.join(folder, 'package.json'))?.version || '').trim();
}

function readServerVersion(folder) {
  const server = readText(path.join(folder, 'server.js'));
  return server.match(/BOT_VERSION\s*=\s*["']([^"']+)["']/)?.[1]?.trim() || '';
}

function expectedVersion() {
  const pkgVersion = readPackageVersion(SOURCE_DIR);
  const serverVersion = readServerVersion(SOURCE_DIR);
  if (pkgVersion && serverVersion && pkgVersion !== serverVersion) {
    console.log(`[ERROR] Paquete inconsistente: package.json=${pkgVersion}, server.js=${serverVersion}`);
    process.exit(6);
  }
  return pkgVersion || serverVersion;
}

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function hasUsableAuthState(dir) {
  return Boolean(dir) && exists(path.join(dir, 'creds.json'));
}

function appDataRoot() {
  return process.env.APPDATA || process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Roaming');
}

function localAppDataRoot() {
  return process.env.LOCALAPPDATA || process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local');
}

function sessionFingerprintFromToken(token, fallback = 'default') {
  return createHash('sha256').update(String(token || fallback)).digest('hex').slice(0, 18);
}

function tokenFingerprintFromFolder(folder) {
  const cfg = readConfig(folder);
  return sessionFingerprintFromToken(cfg?.token || '', folder || 'default');
}

function cleanInstallRoot() {
  return path.join(localAppDataRoot(), INSTALL_ROOT_NAME);
}

function cleanAppDirForFingerprint(fingerprint) {
  void fingerprint;
  return path.join(cleanInstallRoot(), 'app');
}

function cleanLauncherDirForFingerprint(fingerprint) {
  void fingerprint;
  return path.join(cleanInstallRoot(), 'launcher');
}

function persistentAuthDirForFingerprint(fingerprint) {
  return path.join(appDataRoot(), APP_NAME, 'sessions', `sede-${fingerprint}`);
}

function backupRootForFingerprint(fingerprint) {
  return path.join(appDataRoot(), APP_NAME, 'clean-install-backups', `sede-${fingerprint}`);
}

function commonSearchRoots() {
  const userProfile = process.env.USERPROFILE || os.homedir();
  return [
    path.join(userProfile, 'Desktop'),
    path.join(userProfile, 'Documents'),
    path.join(userProfile, 'Downloads'),
    path.join(localAppDataRoot(), ''),
    path.join(appDataRoot(), ''),
    path.join(process.env.ProgramFiles || '', APP_NAME),
    path.join(process.env['ProgramFiles(x86)'] || '', APP_NAME),
    path.join(process.env.ProgramData || '', APP_NAME),
    path.join(userProfile, APP_NAME),
    path.join(userProfile, 'BOT'),
    'C:\\BOT',
    'C:\\GolosoBot',
    'C:\\Goloso WhatsApp Bot',
    userProfile,
  ].filter(Boolean);
}

function searchFolders(root, candidates, maxDepth = 6) {
  const resolvedRoot = resolveFolder(root);
  if (!resolvedRoot) return;
  const excluded = new Set(['node_modules', '.git', 'Cache', 'Caches', 'Code Cache', 'Temp', 'tmp', '$Recycle.Bin']);
  const queue = [{ folder: resolvedRoot, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 70000) {
    const { folder, depth } = queue.shift();
    visited += 1;
    const name = path.basename(folder);
    if (isBackupOrTempFolderName(name)) continue;
    if (name === 'auth_state') {
      addCandidate(candidates, path.dirname(folder));
      continue;
    }
    if (/goloso|whatsapp|bot/i.test(name) || exists(path.join(folder, 'config.json')) || exists(path.join(folder, 'auth_state'))) {
      addCandidate(candidates, folder);
    }
    if (depth >= maxDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue;
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 });
    }
  }
}

function folderFromServerCommand(command) {
  const match = String(command || '').match(/([A-Z]:\\[^\r\n]*?server\.js)/i);
  return match ? path.dirname(match[1].trim().replace(/^['"]+|['"]+$/g, '')) : '';
}

function listNodeServerProcesses() {
  const rows = [];
  try {
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\\.js|goloso-bot-launcher\\.cjs|update-windows\\.js' } | ForEach-Object { ([string]$_.ProcessId) + '|' + ([string]$_.CommandLine) }";
    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(ps)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      const sep = line.indexOf('|');
      if (sep <= 0) continue;
      const pid = line.slice(0, sep).trim();
      const command = line.slice(sep + 1).trim();
      if (/^\d+$/.test(pid)) rows.push({ pid, command, folder: folderFromServerCommand(command) });
    }
  } catch {}
  return rows;
}

function activePanelFolders() {
  const folders = [];
  try {
    const ps = "$ports=8790..8810; foreach($p in $ports){ try { $s=Invoke-RestMethod -UseBasicParsing -Uri ('http://localhost:'+$p+'/status.json') -TimeoutSec 1; if($s.folder -and (Test-Path -LiteralPath $s.folder)){ Write-Output ([string]$s.folder) } } catch {} }";
    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(ps)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) addCandidate({ add: (v) => folders.push(v) }, line.trim());
  } catch {}
  return [...new Set(folders.map(resolveFolder).filter(Boolean))];
}

function candidatesFromStartup() {
  const candidates = new Set();
  try {
    const ps = [
      "$paths=@([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup')) | Where-Object { $_ }",
      "$ws=New-Object -ComObject WScript.Shell",
      "foreach($p in $paths){ if(Test-Path $p){ Get-ChildItem -LiteralPath $p -Filter '*.lnk' | ForEach-Object { try { $s=$ws.CreateShortcut($_.FullName); Write-Output ($s.TargetPath + ' ' + $s.Arguments + ' ' + $s.WorkingDirectory) } catch {} } } }",
      "$runs=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')",
      "foreach($run in $runs){ if(Test-Path $run){ Get-ItemProperty -Path $run | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' } | ForEach-Object { Write-Output ([string]$_.Value) } } } }",
      "try { Get-ScheduledTask | Where-Object { ($_.TaskName -match 'Goloso|WhatsApp') -or (($_.Actions | Out-String) -match 'Goloso|WhatsApp|server\\.js|start-hidden\\.vbs|goloso-bot-launcher') } | ForEach-Object { $_.Actions | ForEach-Object { Write-Output (($_.Execute + ' ' + $_.Arguments + ' ' + $_.WorkingDirectory)) } } } catch {}",
    ].join('; ');
    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(ps)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      const text = line.trim();
      if (!/goloso|whatsapp|server\.js|start-hidden\.vbs|launcher/i.test(text)) continue;
      const serverMatch = text.match(/([A-Z]:\\[^\r\n"']*?server\.js)/i);
      const vbsMatch = text.match(/([A-Z]:\\[^\r\n"']*?(?:start-hidden|goloso-bot-launcher)\.vbs)/i);
      const dirMatch = text.match(/([A-Z]:\\[^\r\n"']*?(?:Goloso[^\r\n"']*|whatsapp-bot[^\r\n"']*))/i);
      if (serverMatch) addCandidate(candidates, path.dirname(serverMatch[1]));
      if (vbsMatch) addCandidate(candidates, path.dirname(vbsMatch[1]));
      if (dirMatch) addCandidate(candidates, dirMatch[1]);
    }
  } catch {}
  return [...candidates];
}

function scoreFolder(folder) {
  let score = 0;
  if (exists(path.join(folder, 'config.json'))) score += 120;
  if (hasUsableAuthState(path.join(folder, 'auth_state'))) score += 100;
  if (exists(path.join(folder, 'server.js'))) score += 60;
  if (exists(path.join(folder, 'package.json'))) score += 30;
  if (exists(path.join(folder, 'start-hidden.vbs'))) score += 20;
  const version = readPackageVersion(folder) || readServerVersion(folder);
  if (version) score += Math.max(0, Math.min(50, compareVersions(version, '8.0.0') + 20));
  try { score += Math.min(20, fs.statSync(folder).mtimeMs / 1e12); } catch {}
  return score;
}

function findInstalledBotFolder() {
  const candidates = new Set();
  for (const folder of activePanelFolders()) addCandidate(candidates, folder);
  for (const proc of listNodeServerProcesses()) addCandidate(candidates, proc.folder);
  for (const folder of candidatesFromStartup()) addCandidate(candidates, folder);
  if (exists(path.join(SOURCE_DIR, 'config.json')) || exists(path.join(SOURCE_DIR, 'auth_state'))) addCandidate(candidates, SOURCE_DIR);

  step('Busqueda profunda automatica');
  console.log('Revisando procesos, accesos directos, Registro, tareas, AppData, Descargas y carpetas comunes...');
  for (const root of [...new Set(commonSearchRoots())]) searchFolders(root, candidates, 6);

  const valid = [...candidates].filter(isBotFolder);
  valid.sort((a, b) => scoreFolder(b) - scoreFolder(a));
  return valid[0] || '';
}

function searchUsableAuthDirs(root, results, maxDepth = 7) {
  const resolvedRoot = resolveFolder(root);
  if (!resolvedRoot) return;
  const excluded = new Set(['node_modules', '.git', 'Cache', 'Caches', 'Code Cache', 'Temp', 'tmp']);
  const queue = [{ folder: resolvedRoot, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 70000) {
    const { folder, depth } = queue.shift();
    visited += 1;
    if (isBackupOrTempFolderName(path.basename(folder))) continue;
    if (hasUsableAuthState(folder)) results.push(folder);
    const authState = path.join(folder, 'auth_state');
    if (hasUsableAuthState(authState)) results.push(authState);
    if (depth >= maxDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue;
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 });
    }
  }
}

function sameToken(folder, token) {
  const cfg = readConfig(folder);
  return Boolean(token && cfg?.token && String(cfg.token) === String(token));
}

function collectReusableAuthDirs(target, fingerprint) {
  const cfg = readConfig(target);
  const token = String(cfg?.token || '');
  const results = [];
  const persistent = persistentAuthDirForFingerprint(fingerprint);
  if (hasUsableAuthState(persistent)) results.push(persistent);
  if (hasUsableAuthState(path.join(target, 'auth_state'))) results.push(path.join(target, 'auth_state'));
  const botCandidates = new Set();
  for (const root of [...new Set([target, path.dirname(target), ...commonSearchRoots()])]) {
    searchFolders(root, botCandidates, 7);
  }
  for (const folder of botCandidates) {
    if (!sameToken(folder, token)) continue;
    if (hasUsableAuthState(path.join(folder, 'auth_state'))) results.push(path.join(folder, 'auth_state'));
    const candidateFingerprint = tokenFingerprintFromFolder(folder);
    const candidatePersistent = persistentAuthDirForFingerprint(candidateFingerprint);
    if (candidateFingerprint === fingerprint && hasUsableAuthState(candidatePersistent)) results.push(candidatePersistent);
  }
  const unique = [...new Set(results.map(resolveFolder).filter(Boolean))];
  unique.sort((a, b) => {
    const rank = (folder) => {
      let value = 0;
      if (normalizeForCompare(folder) === normalizeForCompare(persistent)) value += 500;
      if (/Goloso WhatsApp Bot[\\/]sessions/i.test(folder)) value += 300;
      if (/auth_state$/i.test(folder)) value += 200;
      try { value += Math.min(100, fs.statSync(path.join(folder, 'creds.json')).mtimeMs / 1e12); } catch {}
      return value;
    };
    return rank(b) - rank(a);
  });
  return unique;
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function removeContents(folder, preserveNames = new Set()) {
  if (!exists(folder)) return;
  for (const entry of fs.readdirSync(folder)) {
    if (preserveNames.has(entry)) continue;
    fs.rmSync(path.join(folder, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
}

function inferPortFromFolder(folder) {
  const cfg = readConfig(folder);
  const text = `${folder} ${cfg?.branch || ''} ${cfg?.name || ''}`;
  return /sede\s*2|sede2|parque/i.test(text) ? 8791 : 8790;
}

function stopAllGolosoProcesses() {
  step('Cerrando por completo procesos antiguos');
  const currentPid = String(process.pid);
  for (const proc of listNodeServerProcesses()) {
    if (String(proc.pid) === currentPid) continue;
    const haystack = `${proc.command || ''} ${proc.folder || ''}`;
    if (/goloso|whatsapp|server\.js|goloso-bot-launcher|update-windows\.js/i.test(haystack)) {
      spawnSync('taskkill', ['/F', '/PID', proc.pid, '/T'], { shell: true, stdio: 'ignore' });
    }
  }
  try {
    const output = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      if (!LOCAL_PORTS.some((port) => line.includes(`:${port}`))) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (/^\d+$/.test(pid) && pid !== currentPid) spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { shell: true, stdio: 'ignore' });
    }
  } catch {}
}

function cleanupStartupAndUpdaterCaches() {
  step('Eliminando arranques, caches e instaladores viejos');
  const cleanRoot = cleanInstallRoot().replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$cleanRoot='${cleanRoot}'`,
    "$startupPaths=@([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup')) | Where-Object { $_ }",
    "$ws=New-Object -ComObject WScript.Shell",
    "foreach($startup in $startupPaths){ if(Test-Path $startup){ Get-ChildItem -LiteralPath $startup -Filter '*.lnk' | ForEach-Object { $delete=$false; try { $s=$ws.CreateShortcut($_.FullName); $blob=(($_.Name+' '+$s.TargetPath+' '+$s.Arguments+' '+$s.WorkingDirectory)).ToLowerInvariant(); if($blob -match 'goloso|whatsapp|server\\.js|start-hidden\\.vbs|goloso-bot-launcher|golosobotruntime'){ $delete=$true } } catch { if($_.Name -match 'Goloso|WhatsApp'){ $delete=$true } }; if($delete){ Remove-Item -LiteralPath $_.FullName -Force } } } }",
    "$runs=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')",
    "foreach($run in $runs){ if(Test-Path $run){ Get-ItemProperty -Path $run | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' } | ForEach-Object { $name=$_.Name; $value=String($_.Value); $blob=($name+' '+$value).ToLowerInvariant(); if($blob -match 'goloso|whatsapp|server\\.js|start-hidden\\.vbs|goloso-bot-launcher|golosobotruntime'){ Remove-ItemProperty -Path $run -Name $name -Force } } } } }",
    "try { Get-ScheduledTask | Where-Object { ($_.TaskName -match 'Goloso|WhatsApp|Golosito') -or (($_.Actions | Out-String) -match 'Goloso|WhatsApp|server\\.js|start-hidden\\.vbs|goloso-bot-launcher|golosobotruntime') } | Unregister-ScheduledTask -Confirm:$false } catch {}",
    "$tempRoots=@($env:TEMP,$env:TMP,(Join-Path $env:LOCALAPPDATA 'Temp')) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique",
    "foreach($t in $tempRoots){ Get-ChildItem -LiteralPath $t -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'goloso|golosito|whatsapp-bot|squirrel|electron-updater' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }",
    "$cacheRoots=@((Join-Path $env:LOCALAPPDATA 'SquirrelTemp'),(Join-Path $env:LOCALAPPDATA 'electron-updater'),(Join-Path $env:APPDATA 'electron-updater'),(Join-Path $env:LOCALAPPDATA 'goloso-updater'),(Join-Path $env:APPDATA 'goloso-updater'))",
    "foreach($c in $cacheRoots){ if(Test-Path $c){ Remove-Item -LiteralPath $c -Recurse -Force -ErrorAction SilentlyContinue } }",
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore' });
}

function collectRelatedInstallDirs(target, fingerprint) {
  const token = String(readConfig(target)?.token || '');
  const candidates = new Set();
  addCandidate(candidates, target);
  addCandidate(candidates, cleanAppDirForFingerprint(fingerprint));
  for (const folder of activePanelFolders()) addCandidate(candidates, folder);
  for (const proc of listNodeServerProcesses()) addCandidate(candidates, proc.folder);
  for (const folder of candidatesFromStartup()) addCandidate(candidates, folder);
  for (const root of [...new Set([target, path.dirname(target), cleanInstallRoot(), ...commonSearchRoots()])]) searchFolders(root, candidates, 6);
  return [...candidates]
    .map(resolveFolder)
    .filter(Boolean)
    .filter((folder) => !isBackupOrTempFolderName(path.basename(folder)))
    .filter((folder) => {
      if (normalizeForCompare(folder) === normalizeForCompare(SOURCE_DIR)) return false;
      if (normalizeForCompare(folder) === normalizeForCompare(cleanAppDirForFingerprint(fingerprint))) return true;
      if (sameToken(folder, token)) return true;
      const version = readPackageVersion(folder) || readServerVersion(folder);
      return /goloso|whatsapp|bot/i.test(folder) && Boolean(version) && compareVersions(version, expectedVersion()) < 0;
    });
}

function copyPackageFiles(target) {
  const files = [
    'server.js',
    'setup.js',
    'install-windows.bat',
    'update-windows.bat',
    'update-windows.ps1',
    'update-windows.js',
    'ACTUALIZAR-SIN-QR.bat',
    'SOLUCION-SIN-SABER-CARPETA.bat',
    'start-hidden.vbs',
    'uninstall-windows.bat',
    'README.md',
    'package.json',
    'package-lock.json',
  ];
  for (const file of files) {
    const src = path.join(SOURCE_DIR, file);
    if (exists(src)) fs.copyFileSync(src, path.join(target, file));
  }
}

function ensureDependencies(target) {
  if (exists(path.join(target, 'node_modules', '@whiskeysockets', 'baileys'))) return;
  const sourceModules = path.join(SOURCE_DIR, 'node_modules');
  if (exists(path.join(sourceModules, '@whiskeysockets', 'baileys'))) {
    copyRecursive(sourceModules, path.join(target, 'node_modules'));
    return;
  }
  step('Instalando dependencias');
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: target, shell: true, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function validateSourcePackage() {
  step('Validando paquete nuevo');
  const expected = expectedVersion();
  if (!expected) {
    console.log('[ERROR] El ZIP no contiene version valida en package.json/server.js.');
    process.exit(6);
  }
  const required = ['server.js', 'package.json', 'setup.js', 'start-hidden.vbs'];
  for (const file of required) {
    if (!exists(path.join(SOURCE_DIR, file))) {
      console.log(`[ERROR] El ZIP no contiene ${file}.`);
      process.exit(6);
    }
  }
  console.log(`Version del paquete nuevo: ${expected}`);
  return expected;
}

function installCleanRuntime(target, fingerprint, expected) {
  step('Instalando runtime limpio y unico');
  const cfg = readConfig(target);
  const cleanDir = cleanAppDirForFingerprint(fingerprint);
  const authDir = persistentAuthDirForFingerprint(fingerprint);
  const backupRoot = backupRootForFingerprint(fingerprint);
  const backupDir = path.join(backupRoot, new Date().toISOString().replace(/[-:]/g, '').slice(0, 15));
  fs.mkdirSync(cleanDir, { recursive: true });
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  if (exists(path.join(target, 'config.json'))) fs.copyFileSync(path.join(target, 'config.json'), path.join(backupDir, 'config.json'));
  if (hasUsableAuthState(path.join(target, 'auth_state'))) copyRecursive(path.join(target, 'auth_state'), path.join(backupDir, 'auth_state'));
  if (hasUsableAuthState(authDir)) copyRecursive(authDir, path.join(backupDir, 'persistent_auth_state'));

  const reusableAuth = collectReusableAuthDirs(target, fingerprint)[0] || '';
  if (reusableAuth && normalizeForCompare(reusableAuth) !== normalizeForCompare(authDir)) {
    console.log(`Sesion WhatsApp conservada desde: ${reusableAuth}`);
    removeContents(authDir);
    copyRecursive(reusableAuth, authDir);
  }

  removeContents(cleanDir, new Set(['config.json']));
  copyPackageFiles(cleanDir);
  writeJson(path.join(cleanDir, 'config.json'), { ...(cfg || {}), apiUrl: API_URL });
  if (hasUsableAuthState(authDir)) copyRecursive(authDir, path.join(cleanDir, 'auth_state'));
  ensureDependencies(cleanDir);
  writeJson(path.join(cleanDir, 'installation.json'), {
    app: APP_NAME,
    method: 'clean-runtime-v1',
    version: expected,
    installedAt: new Date().toISOString(),
    installDir: cleanDir,
    previousTarget: target,
    persistentAuthDir: authDir,
    backupDir,
  });
  return cleanDir;
}

function neutralizeOldFolders(folders, cleanDir, launcherVbsPath, expected) {
  step('Neutralizando copias antiguas');
  const clean = normalizeForCompare(cleanDir);
  const unique = [...new Set(folders.map(resolveFolder).filter(Boolean))];
  for (const folder of unique) {
    const normalized = normalizeForCompare(folder);
    if (!normalized || normalized === clean || normalized === normalizeForCompare(SOURCE_DIR)) continue;
    try {
      for (const marker of ['.goloso-bot.lock', '.goloso-bridge-update-8.22.2', '.goloso-bridge-update-8.22.3', '.goloso-bridge-update-8.22.4', '.goloso-bridge-update-8.22.5', '.goloso-bridge-update-8.22.6']) {
        fs.rmSync(path.join(folder, marker), { force: true });
      }
      const redirect = [
        'Set WshShell = CreateObject("WScript.Shell")',
        `WshShell.Run "wscript.exe //nologo ""${launcherVbsPath.replace(/\\/g, '\\\\')}""", 0, False`,
      ].join('\r\n');
      fs.writeFileSync(path.join(folder, 'start-hidden.vbs'), redirect, 'utf8');
      fs.writeFileSync(path.join(folder, 'OBSOLETO-USAR-RUNTIME-LIMPIO.txt'), `Esta copia fue neutralizada. Version instalada activa: ${expected}\r\nRuta activa: ${cleanDir}\r\n`, 'utf8');
      const pkg = readJson(path.join(folder, 'package.json'));
      if (pkg?.version && compareVersions(String(pkg.version), expected) < 0) {
        pkg.version = `${expected}-redirect`;
        writeJson(path.join(folder, 'package.json'), pkg);
      }
      console.log(`Neutralizada: ${folder}`);
    } catch (e) {
      console.log(`AVISO: no se pudo neutralizar ${folder}: ${e?.message || e}`);
    }
  }
}

function writeLauncher(cleanDir, fingerprint, expected) {
  const launcherDir = cleanLauncherDirForFingerprint(fingerprint);
  fs.mkdirSync(launcherDir, { recursive: true });
  const configPath = path.join(launcherDir, 'launcher.json');
  const launcherPath = path.join(launcherDir, 'goloso-bot-launcher.cjs');
  const launcherVbsPath = path.join(launcherDir, 'goloso-bot-launcher.vbs');
  const logPath = path.join(launcherDir, 'launcher.log');
  writeJson(configPath, { app: APP_NAME, method: 'clean-runtime-v1', targetDir: cleanDir, expectedVersion: expected, writtenAt: new Date().toISOString() });
  const launcherScript = `const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');
const CONFIG_PATH = ${JSON.stringify(configPath)};
function exists(p){ try { return fs.existsSync(p); } catch { return false; } }
function readJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function readText(p){ try { return fs.readFileSync(p,'utf8'); } catch { return ''; } }
function resolveFolder(p){ try { return p && exists(p) ? fs.realpathSync(p) : ''; } catch { return ''; } }
function version(folder){ return String(readJson(path.join(folder,'package.json'))?.version || '').trim(); }
function serverVersion(folder){ return readText(path.join(folder,'server.js')).match(/BOT_VERSION\\s*=\\s*["']([^"']+)["']/)?.[1]?.trim() || ''; }
function folderFromCommand(command){ const m=String(command||'').match(/([A-Z]:\\\\[^\\r\\n]*?server\\.js)/i); return m ? resolveFolder(path.dirname(m[1].trim().replace(/^['\"]+|['\"]+$/g,''))) : ''; }
function list(){ try { const ps='Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'server\\\\.js\' } | ForEach-Object { ([string]$_.ProcessId) + \'|\' + ([string]$_.CommandLine) }'; const out=execSync('powershell -NoProfile -ExecutionPolicy Bypass -Command '+JSON.stringify(ps),{encoding:'utf8',stdio:['ignore','pipe','ignore']}); return out.split(/\\r?\\n/).map(l=>{ const i=l.indexOf('|'); if(i<=0)return null; return {pid:l.slice(0,i).trim(),command:l.slice(i+1),folder:folderFromCommand(l.slice(i+1))}; }).filter(Boolean); } catch { return []; } }
function kill(pid){ try { spawnSync('taskkill',['/F','/PID',String(pid),'/T'],{shell:true,stdio:'ignore'}); } catch {} }
function valid(config){ const target=resolveFolder(config.targetDir); return Boolean(target) && version(target)===String(config.expectedVersion) && serverVersion(target)===String(config.expectedVersion); }
const config=readJson(CONFIG_PATH);
if(!config || !valid(config)) process.exit(3);
const target=resolveFolder(config.targetDir).toLowerCase();
for(const proc of list()){ const f=resolveFolder(proc.folder).toLowerCase(); if(f && f!==target && /goloso|whatsapp|bot/i.test(f)) kill(proc.pid); }
if(!list().some((proc)=>resolveFolder(proc.folder).toLowerCase()===target)){
  const vbs=path.join(config.targetDir,'start-hidden.vbs');
  if(exists(vbs)) spawn('wscript.exe',['//nologo',vbs],{cwd:config.targetDir,detached:true,stdio:'ignore'}).unref();
  else spawn('node',[path.join(config.targetDir,'server.js')],{cwd:config.targetDir,detached:true,stdio:'ignore'}).unref();
}
`;
  fs.writeFileSync(launcherPath, launcherScript, 'utf8');
  const vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.CurrentDirectory = "${launcherDir.replace(/\\/g, '\\\\')}"`,
    `WshShell.Run "cmd /c node ""${launcherPath.replace(/\\/g, '\\\\')}"" >> ""${logPath.replace(/\\/g, '\\\\')}"" 2>&1", 0, False`,
  ].join('\r\n');
  fs.writeFileSync(launcherVbsPath, vbs, 'utf8');
  return { launcherDir, launcherVbsPath, configPath };
}

function registerCleanStartup(launcher, fingerprint) {
  step('Registrando unico inicio automatico');
  const startup = path.join(appDataRoot(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  fs.mkdirSync(startup, { recursive: true });
  const linkPath = path.join(startup, STARTUP_LINK_NAME);
  const tempVbs = path.join(os.tmpdir(), `goloso_clean_shortcut_${Date.now()}.vbs`);
  const vbs = [
    'Set ws = WScript.CreateObject("WScript.Shell")',
    `Set s = ws.CreateShortcut("${linkPath.replace(/\\/g, '\\\\')}")`,
    's.TargetPath = "wscript.exe"',
    `s.Arguments = Chr(34) & "${launcher.launcherVbsPath.replace(/\\/g, '\\\\')}" & Chr(34)`,
    `s.WorkingDirectory = "${launcher.launcherDir.replace(/\\/g, '\\\\')}"`,
    's.WindowStyle = 7',
    's.IconLocation = "wscript.exe, 0"',
    's.Description = "Goloso WhatsApp Bot"',
    's.Save',
  ].join('\r\n');
  try {
    fs.writeFileSync(tempVbs, vbs, 'utf8');
    spawnSync('cscript', ['//nologo', tempVbs], { shell: true, stdio: 'ignore' });
  } finally {
    try { fs.unlinkSync(tempVbs); } catch {}
  }
  spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', RUN_VALUE_NAME, '/t', 'REG_SZ', '/d', `wscript.exe "${launcher.launcherVbsPath}"`, '/f'], { stdio: 'ignore' });
  spawnSync('schtasks', ['/Create', '/SC', 'ONLOGON', '/TN', `${RUN_VALUE_NAME}-Clean-${fingerprint}`, '/TR', `wscript.exe "${launcher.launcherVbsPath}"`, '/F'], { shell: true, stdio: 'ignore' });
}

function verifyFiles(expected, cleanDir) {
  const pkg = readPackageVersion(cleanDir);
  const server = readServerVersion(cleanDir);
  const install = readJson(path.join(cleanDir, 'installation.json'))?.version || '';
  if (pkg !== expected || server !== expected || install !== expected) {
    console.log(`[ERROR] Versiones de archivos no coinciden. package=${pkg}, server=${server}, installation=${install}, esperado=${expected}`);
    return false;
  }
  return true;
}

function fetchStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/status.json', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function waitForActiveVersion(expected, cleanDir, preferredPort) {
  const target = normalizeForCompare(cleanDir);
  const ports = [...new Set([preferredPort, ...LOCAL_PORTS])];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    for (const port of ports) {
      const status = await fetchStatus(port);
      if (!status?.version) continue;
      const folder = normalizeForCompare(String(status.folder || ''));
      if (String(status.version).trim() === expected && folder === target) {
        console.log(`OK: version en memoria ${status.version}, puerto ${port}, carpeta ${status.folder}`);
        return true;
      }
      console.log(`Puerto ${port}: version=${status.version}, carpeta=${status.folder || 'desconocida'}; esperando ${expected} en ${cleanDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function simulateRestart(expected, cleanDir, launcher, preferredPort) {
  step('Prueba real de reinicio del bot');
  stopAllGolosoProcesses();
  spawn('wscript.exe', ['//nologo', launcher.launcherVbsPath], { cwd: launcher.launcherDir, detached: true, stdio: 'ignore' }).unref();
  const ok = await waitForActiveVersion(expected, cleanDir, preferredPort);
  if (!ok) {
    console.log('[ERROR] Tras simular reinicio, no quedo activa la version esperada.');
    return false;
  }
  return true;
}

function printValidationSummary(expected, cleanDir, launcher) {
  console.log('');
  console.log('Validaciones finales:');
  console.log(` - Ubicacion ejecutable: ${path.join(cleanDir, 'server.js')}`);
  console.log(` - Version package.json: ${readPackageVersion(cleanDir)}`);
  console.log(` - Version server.js: ${readServerVersion(cleanDir)}`);
  console.log(` - Version installation.json: ${readJson(path.join(cleanDir, 'installation.json'))?.version || ''}`);
  console.log(` - Version instalador descargado: ${expectedVersion()}`);
  console.log(` - Launcher unico: ${launcher.launcherVbsPath}`);
}

async function main() {
  console.log('');
  console.log('Goloso WhatsApp Bot - instalacion limpia definitiva');
  console.log('Este metodo NO repara el updater anterior: lo reemplaza por un runtime limpio, unico y verificable.');

  const expected = validateSourcePackage();
  let targetDir = '';
  if (targetPath) {
    if (!exists(targetPath)) {
      console.log(`La ruta indicada no existe: ${targetPath}`);
      process.exit(4);
    }
    targetDir = resolveFolder(targetPath);
    if (path.basename(targetDir).toLowerCase() === 'auth_state') targetDir = path.dirname(targetDir);
  } else {
    targetDir = findInstalledBotFolder();
  }

  if (!targetDir) {
    console.log('No se encontro automaticamente la instalacion anterior del bot.');
    process.exit(2);
  }
  if (!exists(path.join(targetDir, 'config.json'))) {
    console.log('[ERROR] La carpeta detectada no tiene config.json; no se puede identificar la sede.');
    process.exit(2);
  }

  const cfg = readConfig(targetDir);
  const fingerprint = sessionFingerprintFromToken(cfg?.token || '', targetDir);
  const authCandidates = collectReusableAuthDirs(targetDir, fingerprint);
  if (authCandidates.length === 0) {
    console.log('AVISO: No se encontro una sesion WhatsApp previa (ni auth_state ni sesion persistente).');
    if (autoFromInstaller) process.exit(3);
    if (!force) {
      console.log('Cancelando para no convertir una actualizacion sin QR en instalacion nueva.');
      process.exit(3);
    }
    console.log('Continuando por --force. Es posible que WhatsApp pida QR.');
  }

  console.log(`Carpeta anterior detectada: ${targetDir}`);
  console.log(`Runtime limpio destino: ${cleanAppDirForFingerprint(fingerprint)}`);
  console.log(`Sesion persistente destino: ${persistentAuthDirForFingerprint(fingerprint)}`);
  console.log('El codigo ejecutable usa una unica ruta fija; solo la sesion se separa por sede.');

  const relatedDirs = collectRelatedInstallDirs(targetDir, fingerprint);
  stopAllGolosoProcesses();
  cleanupStartupAndUpdaterCaches();
  const cleanDir = installCleanRuntime(targetDir, fingerprint, expected);
  const launcher = writeLauncher(cleanDir, fingerprint, expected);
  neutralizeOldFolders(relatedDirs, cleanDir, launcher.launcherVbsPath, expected);
  registerCleanStartup(launcher, fingerprint);

  if (!verifyFiles(expected, cleanDir)) process.exit(5);
  const preferredPort = inferPortFromFolder(cleanDir);
  const restartOk = await simulateRestart(expected, cleanDir, launcher, preferredPort);
  printValidationSummary(expected, cleanDir, launcher);
  if (!restartOk) process.exit(5);

  console.log('');
  console.log(`Actualizacion limpia completa. Version activa y persistente: ${expected}`);
  console.log('La version antigua quedo neutralizada y Windows arrancara solo desde el runtime limpio.');
}

main().catch((error) => {
  console.error('[ERROR]', error?.message || error);
  process.exit(1);
});