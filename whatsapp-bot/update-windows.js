import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PORTS = Array.from({ length: 21 }, (_, index) => 8790 + index);
const API_URL = 'https://golosoheladeria.lovable.app';
const RELEASE_MANIFEST_URL = `${API_URL}/downloads/manifest.json`;
const APP_DATA_FOLDER = 'Goloso WhatsApp Bot';
const STARTUP_LINK_NAME = 'Goloso WhatsApp Bot.lnk';
const RUN_VALUE_NAME = 'GolosoWhatsAppBot';
const LAUNCHER_FOLDER_NAME = 'launcher';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
};

const autoFromInstaller = hasFlag('--auto-from-installer');
const force = hasFlag('--force');
let targetPath = getValue('--target').trim().replace(/^['"]+|['"]+$/g, '');

function step(text) {
  console.log('');
  console.log(`== ${text} ==`);
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveFolder(folder) {
  try {
    if (!folder || !exists(folder)) return '';
    return fs.realpathSync(folder);
  } catch {
    return '';
  }
}

function addCandidate(set, folder) {
  const resolved = resolveFolder(folder);
  if (resolved) set.add(resolved);
}

function isBotFolder(folder) {
  const hasIdentity = exists(path.join(folder, 'config.json')) || exists(path.join(folder, 'auth_state'));
  const hasExecutable = exists(path.join(folder, 'server.js')) || exists(path.join(folder, 'package.json')) || exists(path.join(folder, 'start-hidden.vbs'));
  return hasIdentity && hasExecutable;
}

function isBackupOrTempFolderName(name) {
  return /^backup-before-update/i.test(name)
    || /^goloso-bot-update-/i.test(name)
    || /^extract$/i.test(name)
    || /^pkg$/i.test(name)
    || /^session-backups$/i.test(name)
    || /^sessions$/i.test(name)
    || /^session-meta$/i.test(name);
}

function scoreFolder(folder) {
  let score = 0;
  if (hasUsableAuthState(path.join(folder, 'auth_state'))) score += 180;
  else if (exists(path.join(folder, 'auth_state'))) score += 20;
  if (hasPersistentAuthState(folder)) score += 120;
  if (exists(path.join(folder, 'config.json'))) score += 80;
  if (exists(path.join(folder, 'server.js'))) score += 40;
  if (exists(path.join(folder, 'start-hidden.vbs'))) score += 20;
  if (exists(path.join(folder, 'package.json'))) score += 10;
  return score;
}

function commonSearchRoots() {
  const userProfile = process.env.USERPROFILE || os.homedir();
  return [
    path.join(userProfile, 'Desktop'),
    path.join(userProfile, 'Documents'),
    path.join(userProfile, 'Downloads'),
    path.join(process.env.LOCALAPPDATA || '', ''),
    path.join(process.env.APPDATA || '', ''),
    path.join(process.env.ProgramFiles || '', 'Goloso WhatsApp Bot'),
    path.join(process.env.ProgramData || '', 'Goloso WhatsApp Bot'),
    path.join(userProfile, 'Goloso WhatsApp Bot'),
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

  const excluded = new Set(['node_modules', '.git', 'Cache', 'Caches', 'Code Cache', 'Temp', 'tmp']);
  const queue = [{ folder: resolvedRoot, depth: 0 }];
  let visited = 0;

  while (queue.length && visited < 50000) {
    const { folder, depth } = queue.shift();
    visited += 1;

    const name = path.basename(folder);
    if (isBackupOrTempFolderName(name)) continue;
    if (name === 'auth_state') {
      addCandidate(candidates, path.dirname(folder));
      continue;
    }

    if (/Goloso.*Bot/i.test(name) || /WhatsApp.*Bot/i.test(name) || /^whatsapp-bot/i.test(name) || /^BOT/i.test(name)) {
      addCandidate(candidates, folder);
    }
    if (exists(path.join(folder, 'auth_state')) || exists(path.join(folder, 'config.json'))) {
      addCandidate(candidates, folder);
    }
    if (depth >= maxDepth) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue;
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 });
    }
  }
}

function candidatesFromProcessList(candidates) {
  try {
    const output = execSync('wmic process where "name=\'node.exe\'" get CommandLine /value', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      if (!/server\.js/i.test(line)) continue;
      const match = line.match(/([A-Z]:\\[^\r\n]*?server\.js)/i);
      if (match) addCandidate(candidates, path.dirname(match[1].trim().replace(/^['"]+|['"]+$/g, '')));
    }
  } catch {}
}

function candidatesFromRegistry(candidates) {
  try {
    const output = execSync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v GolosoWhatsAppBot', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const match = output.match(/([A-Z]:\\[^\r\n]*?start-hidden\.vbs)/i);
    if (match) addCandidate(candidates, path.dirname(match[1].trim().replace(/^['"]+|['"]+$/g, '')));
  } catch {}
}

function activePanelFolderFromLocalStatus() {
  if (process.platform !== 'win32') return '';
  try {
    const ps = "$ports=8790..8810; foreach($p in $ports){ try { $s=Invoke-RestMethod -UseBasicParsing -Uri ('http://localhost:'+$p+'/status.json') -TimeoutSec 1; if($s.folder -and (Test-Path -LiteralPath $s.folder)){ Write-Output $s.folder; exit 0 } } catch {} }; exit 0";
    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return resolveFolder(output.split(/\r?\n/).find(Boolean) || '');
  } catch {
    return '';
  }
}

function findInstalledBotFolder() {
  const candidates = new Set();

  const activePanelFolder = activePanelFolderFromLocalStatus();
  if (activePanelFolder && isBotFolder(activePanelFolder)) {
    step('Panel local activo detectado');
    console.log(`Se actualizará exactamente esta carpeta: ${activePanelFolder}`);
    return activePanelFolder;
  }

  candidatesFromProcessList(candidates);
  candidatesFromRegistry(candidates);

  if (exists(path.join(SOURCE_DIR, 'config.json')) || exists(path.join(SOURCE_DIR, 'auth_state'))) {
    addCandidate(candidates, SOURCE_DIR);
  }

  step('Busqueda profunda automatica');
  console.log('Revisando Escritorio, Descargas, Documentos, AppData y carpetas comunes...');
  for (const root of [...new Set(commonSearchRoots())]) searchFolders(root, candidates, 6);

  const valid = [...candidates].filter(isBotFolder);
  valid.sort((a, b) => {
    const delta = scoreFolder(b) - scoreFolder(a);
    if (delta !== 0) return delta;
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return valid[0] || '';
}

function inferPortFromFolder(folder) {
  return /sede\s*2|sede2|parque/i.test(String(folder || '')) ? 8791 : 8790;
}

function readConfig(folder) {
  try {
    const cfgPath = path.join(folder, 'config.json');
    if (!exists(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return null;
  }
}

function safePathSegment(value, fallback = 'sede') {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function sessionFingerprintFromConfig(cfg, fallbackFolder) {
  return createHash('sha256')
    .update(String(cfg?.token || fallbackFolder || 'default'))
    .digest('hex')
    .slice(0, 18);
}

function persistentSessionRoot() {
  return process.env.GOLOSO_BOT_DATA_DIR
    || process.env.APPDATA
    || process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Roaming');
}

function canonicalAppsRoot() {
  return process.env.GOLOSO_BOT_APP_DIR
    || process.env.LOCALAPPDATA
    || process.env.APPDATA
    || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local');
}

function canonicalInstallDirFor(folder) {
  const cfg = readConfig(folder);
  const fingerprint = sessionFingerprintFromConfig(cfg, folder);
  return path.join(canonicalAppsRoot(), APP_DATA_FOLDER, 'apps', `sede-${fingerprint}`);
}

function launcherDirFor(folder) {
  const cfg = readConfig(folder);
  const fingerprint = sessionFingerprintFromConfig(cfg, folder);
  return path.join(canonicalAppsRoot(), APP_DATA_FOLDER, LAUNCHER_FOLDER_NAME, `sede-${fingerprint}`);
}

function persistentAuthDirFor(folder) {
  const cfg = readConfig(folder);
  if (!cfg?.token) return '';
  return path.join(persistentSessionRoot(), 'Goloso WhatsApp Bot', 'sessions', `sede-${sessionFingerprintFromConfig(cfg, folder)}`);
}

function hasUsableAuthState(dir) {
  return Boolean(dir) && exists(path.join(dir, 'creds.json'));
}

function hasPersistentAuthState(folder) {
  return hasUsableAuthState(persistentAuthDirFor(folder));
}

function searchUsableAuthDirs(root, results, maxDepth = 7) {
  const resolvedRoot = resolveFolder(root);
  if (!resolvedRoot) return;

  const excluded = new Set(['node_modules', '.git', 'Cache', 'Caches', 'Code Cache', 'Temp', 'tmp']);
  const queue = [{ folder: resolvedRoot, depth: 0 }];
  let visited = 0;

  while (queue.length && visited < 60000) {
    const { folder, depth } = queue.shift();
    visited += 1;

    if (isBackupOrTempFolderName(path.basename(folder))) continue;

    if (hasUsableAuthState(folder)) results.push(folder);
    const authState = path.join(folder, 'auth_state');
    if (hasUsableAuthState(authState)) results.push(authState);

    if (depth >= maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue;
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 });
    }
  }
}

function matchingConfigToken(folder, expectedToken) {
  const cfg = readConfig(folder);
  return Boolean(expectedToken && cfg?.token && String(cfg.token) === String(expectedToken));
}

function addMatchingAuthFromBotFolder(folder, expectedToken, matches) {
  if (!matchingConfigToken(folder, expectedToken)) return;
  const legacy = path.join(folder, 'auth_state');
  const persistent = persistentAuthDirFor(folder);
  if (hasUsableAuthState(legacy)) matches.push(legacy);
  if (hasUsableAuthState(persistent)) matches.push(persistent);
}

function findReusableAuthState(target) {
  const targetCfg = readConfig(target);
  const expectedToken = targetCfg?.token ? String(targetCfg.token) : '';
  if (!expectedToken) return '';

  const targetLegacyAuth = resolveFolder(path.join(target, 'auth_state'));
  const targetPersistentAuth = resolveFolder(persistentAuthDirFor(target));
  const botCandidates = new Set();
  const results = [];

  addMatchingAuthFromBotFolder(target, expectedToken, results);
  const expectedPersistent = persistentAuthDirFor(target);
  const expectedBackup = path.join(persistentSessionRoot(), 'Goloso WhatsApp Bot', 'session-backups', sessionFingerprintFromConfig(targetCfg, target), 'latest');
  if (hasUsableAuthState(expectedPersistent)) results.push(expectedPersistent);
  if (hasUsableAuthState(expectedBackup)) results.push(expectedBackup);

  for (const root of [...new Set([target, path.dirname(target), ...commonSearchRoots()])]) {
    searchFolders(root, botCandidates, 7);
  }

  for (const folder of botCandidates) addMatchingAuthFromBotFolder(folder, expectedToken, results);

  const unique = [...new Set(results.map(resolveFolder).filter(Boolean))].filter((folder) => {
    if (targetLegacyAuth && folder === targetLegacyAuth) return false;
    if (targetPersistentAuth && folder === targetPersistentAuth) return false;
    return true;
  });

  unique.sort((a, b) => {
    const score = (folder) => {
      let value = 0;
      if (folder === resolveFolder(expectedPersistent)) value += 500;
      if (folder === resolveFolder(expectedBackup)) value += 420;
      if (/Goloso WhatsApp Bot[\\/]sessions/i.test(folder)) value += 300;
      if (/auth_state$/i.test(folder)) value += 220;
      if (/session-backups[\\/].*[\\/]latest$/i.test(folder)) value += 180;
      try { value += Math.min(100, fs.statSync(path.join(folder, 'creds.json')).mtimeMs / 1e12); } catch {}
      return value;
    };
    return score(b) - score(a);
  });

  return unique[0] || '';
}

function recoverAuthStateFromOtherFolder(target) {
  const source = findReusableAuthState(target);
  if (!source) return false;

  const persistentAuth = persistentAuthDirFor(target);
  const legacyAuth = path.join(target, 'auth_state');
  console.log(`Sesion WhatsApp encontrada en otra ubicacion: ${source}`);
  if (persistentAuth) {
    fs.mkdirSync(path.dirname(persistentAuth), { recursive: true });
    copyRecursive(source, persistentAuth);
    console.log(`Sesion migrada a almacenamiento persistente: ${persistentAuth}`);
  }
  if (!hasUsableAuthState(legacyAuth)) copyRecursive(source, legacyAuth);
  return true;
}

function preserveAuthState(target, backupDir) {
  const legacyAuth = path.join(target, 'auth_state');
  const persistentAuth = persistentAuthDirFor(target);
  if (hasUsableAuthState(legacyAuth)) copyRecursive(legacyAuth, path.join(backupDir, 'auth_state'));
  if (hasUsableAuthState(persistentAuth)) copyRecursive(persistentAuth, path.join(backupDir, 'persistent_auth_state'));
  if (!hasUsableAuthState(persistentAuth) && hasUsableAuthState(legacyAuth)) {
    fs.mkdirSync(path.dirname(persistentAuth), { recursive: true });
    copyRecursive(legacyAuth, persistentAuth);
    console.log(`Sesion migrada a carpeta persistente protegida: ${persistentAuth}`);
  }
}

function restoreAuthStateIfMissing(target, backupDir) {
  const legacyAuth = path.join(target, 'auth_state');
  const persistentAuth = persistentAuthDirFor(target);
  if (!hasUsableAuthState(persistentAuth) && hasUsableAuthState(path.join(backupDir, 'persistent_auth_state'))) {
    fs.mkdirSync(path.dirname(persistentAuth), { recursive: true });
    copyRecursive(path.join(backupDir, 'persistent_auth_state'), persistentAuth);
    console.log('Sesion persistente restaurada desde respaldo de seguridad.');
  }
  if (!hasUsableAuthState(legacyAuth) && hasUsableAuthState(path.join(backupDir, 'auth_state'))) {
    copyRecursive(path.join(backupDir, 'auth_state'), legacyAuth);
    console.log('auth_state legado restaurado desde respaldo de seguridad.');
  }
}

function stopNodeProcessesInFolder(target) {
  const resolvedTarget = resolveFolder(target);
  if (!resolvedTarget) return;
  try {
    const output = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      if (!/server\.js/i.test(line)) continue;
      const pidMatch = line.match(/,(\d+)\s*$/);
      if (!pidMatch) continue;
      const command = line.slice(0, line.length - pidMatch[0].length);
      if (!command.toLowerCase().includes(resolvedTarget.toLowerCase())) continue;
      spawnSync('taskkill', ['/F', '/PID', pidMatch[1], '/T'], { shell: true, stdio: 'ignore' });
    }
  } catch {}
}

function stopNodeProcessesForToken(expectedToken) {
  if (!expectedToken) return;
  try {
    const output = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      if (!/server\.js/i.test(line)) continue;
      const pidMatch = line.match(/,(\d+)\s*$/);
      if (!pidMatch) continue;
      const command = line.slice(0, line.length - pidMatch[0].length);
      const folderMatch = command.match(/([A-Z]:\\[^\r\n]*?server\.js)/i);
      if (!folderMatch) continue;
      const folder = path.dirname(folderMatch[1].trim().replace(/^['"]+|['"]+$/g, ''));
      const cfg = readConfig(folder);
      if (cfg?.token && String(cfg.token) === String(expectedToken)) {
        spawnSync('taskkill', ['/F', '/PID', pidMatch[1], '/T'], { shell: true, stdio: 'ignore' });
      }
    }
  } catch {}
}

function stopCurrentBot(target) {
  step('Cerrando bot anterior');
  const cfg = readConfig(target);
  stopNodeProcessesForToken(cfg?.token ? String(cfg.token) : '');
  stopNodeProcessesInFolder(target);
  const expectedPort = inferPortFromFolder(target);
  const portsToStop = [...new Set([expectedPort, ...LOCAL_PORTS])];
  try {
    const output = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of output.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      if (!portsToStop.some((port) => line.includes(`:${port}`))) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { shell: true, stdio: 'ignore' });
    }
  } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bot.lock'), { force: true }); } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bridge-update-8.22.2'), { force: true }); } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bridge-update-8.22.3'), { force: true }); } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bridge-update-8.22.4'), { force: true }); } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bridge-update-8.22.5'), { force: true }); } catch {}
  try { fs.rmSync(path.join(target, '.goloso-bridge-update-8.22.6'), { force: true }); } catch {}
}

function sameTokenFolder(folder, expectedToken) {
  if (!expectedToken) return false;
  const cfg = readConfig(folder);
  return Boolean(cfg?.token && String(cfg.token) === String(expectedToken));
}

function findRelatedBotFolders(target) {
  const targetCfg = readConfig(target);
  const expectedToken = targetCfg?.token ? String(targetCfg.token) : '';
  if (!expectedToken) return [target];
  const candidates = new Set();
  addCandidate(candidates, target);
  addCandidate(candidates, canonicalInstallDirFor(target));
  for (const root of [...new Set([target, path.dirname(target), canonicalAppsRoot(), ...commonSearchRoots()])]) {
    searchFolders(root, candidates, 7);
  }
  const canonical = resolveFolder(canonicalInstallDirFor(target));
  const folders = [...candidates]
    .filter((folder) => !isBackupOrTempFolderName(path.basename(folder)))
    .filter((folder) => folder === canonical || sameTokenFolder(folder, expectedToken));
  return [...new Set(folders.map(resolveFolder).filter(Boolean))];
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyBotFiles(target) {
  step('Actualizando archivos del bot');
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
    const dest = path.join(target, file);
    if (!exists(src)) continue;
    if (resolveFolder(src) && resolveFolder(src) === resolveFolder(dest)) continue;
    fs.copyFileSync(src, dest);
  }
}

function updateConfig(target) {
  const configPath = path.join(target, 'config.json');
  if (!exists(configPath)) {
    console.log('No se encontro config.json. Si es instalacion nueva, ejecuta install-windows.bat.');
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  cfg.apiUrl = API_URL;
  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

function ensureDependencies(target) {
  if (exists(path.join(target, 'node_modules', '@whiskeysockets', 'baileys'))) return;
  const sourceModules = path.join(SOURCE_DIR, 'node_modules');
  if (exists(path.join(sourceModules, '@whiskeysockets', 'baileys'))) {
    step('Copiando dependencias incluidas');
    copyRecursive(sourceModules, path.join(target, 'node_modules'));
    return;
  }
  step('Instalando dependencias faltantes');
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: target, shell: true, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function cleanupOldStartupEntries(canonicalTarget) {
  step('Eliminando arranques antiguos');
  const canonical = resolveFolder(canonicalTarget).toLowerCase().replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$canonical='${canonical}'`,
    "$startup=[Environment]::GetFolderPath('Startup')",
    "$ws=New-Object -ComObject WScript.Shell",
    "if(Test-Path $startup){ Get-ChildItem -LiteralPath $startup -Filter '*.lnk' | ForEach-Object { $delete=$false; try { $s=$ws.CreateShortcut($_.FullName); $blob=(($_.Name+' '+$s.TargetPath+' '+$s.Arguments+' '+$s.WorkingDirectory)).ToLowerInvariant(); if($blob -match 'goloso|whatsapp|server\\.js|start-hidden\\.vbs'){ $delete=$true }; if($s.WorkingDirectory -and $s.WorkingDirectory.ToLowerInvariant() -eq $canonical){ $delete=$false } } catch { if($_.Name -match 'Goloso|WhatsApp'){ $delete=$true } }; if($delete){ Remove-Item -LiteralPath $_.FullName -Force } } }",
    "$run='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
    "if(Test-Path $run){ Get-ItemProperty -Path $run | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' } | ForEach-Object { $name=$_.Name; $value=String($_.Value); $blob=($name+' '+$value).ToLowerInvariant(); if($blob -match 'goloso|whatsapp|server\\.js|start-hidden\\.vbs'){ Remove-ItemProperty -Path $run -Name $name -Force } } } }",
    "try { Get-ScheduledTask | Where-Object { ($_.TaskName -match 'Goloso|WhatsApp') -or (($_.Actions | Out-String) -match 'Goloso|WhatsApp|server\\.js|start-hidden\\.vbs') } | Unregister-ScheduledTask -Confirm:$false } catch {}",
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore' });
}

function registerStartup(target) {
  step('Registrando inicio automatico estable');
  cleanupOldStartupEntries(target);
  const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const vbsPath = path.join(target, 'start-hidden.vbs');
  const tempVbs = path.join(os.tmpdir(), `goloso_bot_shortcut_${Date.now()}.vbs`);
  const linkPath = path.join(startup, STARTUP_LINK_NAME);
  fs.mkdirSync(startup, { recursive: true });
  const vbs = [
    'Set ws = WScript.CreateObject("WScript.Shell")',
    `Set s = ws.CreateShortcut("${linkPath.replace(/\\/g, '\\\\')}")`,
    's.TargetPath = "wscript.exe"',
    `s.Arguments = Chr(34) & "${vbsPath.replace(/\\/g, '\\\\')}" & Chr(34)`,
    `s.WorkingDirectory = "${target.replace(/\\/g, '\\\\')}"`,
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
  spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', RUN_VALUE_NAME, '/t', 'REG_SZ', '/d', `wscript.exe "${vbsPath}"`, '/f'], { stdio: 'ignore' });
  const taskName = `${RUN_VALUE_NAME}-${sessionFingerprintFromConfig(readConfig(target), target)}`;
  spawnSync('schtasks', ['/Create', '/SC', 'ONLOGON', '/TN', taskName, '/TR', `wscript.exe "${vbsPath}"`, '/F'], { shell: true, stdio: 'ignore' });
}

function writeInstallManifest(target, sourceTarget) {
  const expected = readExpectedVersion();
  const manifest = {
    app: 'Goloso WhatsApp Bot',
    version: expected,
    installedAt: new Date().toISOString(),
    installDir: target,
    sourceTarget,
    configPath: path.join(target, 'config.json'),
    persistentAuthDir: persistentAuthDirFor(target),
    startup: { runValue: RUN_VALUE_NAME, shortcut: STARTUP_LINK_NAME },
  };
  fs.writeFileSync(path.join(target, 'installation.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function verifyFilesVersion(expected, target) {
  const pkgPath = path.join(target, 'package.json');
  const serverPath = path.join(target, 'server.js');
  const pkg = exists(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;
  const server = exists(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '';
  return String(pkg?.version || '').trim() === expected && server.includes(`BOT_VERSION = "${expected}"`);
}

function waitForPanel(port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get({ hostname: 'localhost', port, path: '/status.json', timeout: 1000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - started > 30000) resolve(false);
        else setTimeout(tick, 1000);
      });
      req.on('timeout', () => {
        req.destroy();
      });
    };
    tick();
  });
}

function readExpectedVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
    return String(pkg.version || '').trim();
  } catch {
    return '';
  }
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

function fetchRemoteManifest() {
  return new Promise((resolve, reject) => {
    const url = `${RELEASE_MANIFEST_URL}?t=${Date.now()}`;
    const req = https.get(url, {
      timeout: 10_000,
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent': `GolosoBotUpdater/${readExpectedVersion() || 'unknown'}`,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`manifest HTTP ${res.statusCode}`));
          return;
        }
        try {
          const manifest = JSON.parse(body);
          if (!manifest.version || !manifest.zipUrl) throw new Error('manifest incompleto');
          resolve(manifest);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('manifest timeout'));
    });
  });
}

async function validateSourcePackageAgainstManifest() {
  step('Validando version oficial publicada');
  let manifest;
  try {
    manifest = await fetchRemoteManifest();
  } catch (e) {
    if (process.env.GOLOSO_BOT_ALLOW_OFFLINE_UPDATE === '1') {
      console.log(`AVISO: no se pudo consultar manifiesto remoto (${e?.message || e}). Continuando por GOLOSO_BOT_ALLOW_OFFLINE_UPDATE=1.`);
      return { version: readExpectedVersion(), offline: true };
    }
    console.log(`[ERROR] No se pudo consultar la version oficial publicada: ${e?.message || e}`);
    console.log('No se aplico ningun cambio para evitar reinstalar una version vieja por error. Revisa internet y ejecuta de nuevo el actualizador remoto.');
    process.exit(6);
  }
  const localVersion = readExpectedVersion();
  const officialVersion = String(manifest.version || '').trim();
  console.log(`Version del paquete descargado: ${localVersion || 'desconocida'}`);
  console.log(`Version oficial publicada: ${officialVersion}`);
  if (!localVersion || compareVersions(localVersion, officialVersion) < 0) {
    console.log('[ERROR] El paquete local es anterior a la version oficial publicada.');
    console.log('Se cancela para impedir que Windows vuelva a arrancar una version antigua. Ejecuta actualizar-bot-windows-remoto.bat desde la nube.');
    process.exit(6);
  }
  return manifest;
}

function fetchStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/status.json', timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function verifyInstalledVersion(expected, target, expectedPort) {
  if (!expected) return true;
  step(`Verificando version activa (esperada: ${expected})`);
  const resolvedTarget = resolveFolder(target);
  const ports = [expectedPort, ...LOCAL_PORTS.filter((port) => port !== expectedPort)];
  for (let i = 0; i < 20; i++) {
    for (const port of ports) {
      const s = await fetchStatus(port);
      if (s && String(s.version || '').trim() === expected) {
        const statusFolder = resolveFolder(String(s.folder || ''));
        if (!resolvedTarget || !statusFolder || statusFolder === resolvedTarget) {
          console.log(`OK: bot activo version ${s.version} en puerto ${port}`);
          return true;
        }
      }
      if (s && s.version) console.log(`Puerto ${port}: version actual ${s.version}, esperando ${expected}...`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`[ERROR] La version activa no coincide con ${expected}.`);
  console.log('Un proceso viejo del bot esta bloqueando el puerto. Cierra sesion de Windows y vuelve a ejecutar el actualizador.');
  return false;
}

async function startBot(target) {
  step('Iniciando bot actualizado');
  const port = inferPortFromFolder(target);
  spawn('wscript.exe', ['//nologo', path.join(target, 'start-hidden.vbs')], { cwd: target, detached: true, stdio: 'ignore' }).unref();
  const ok = await waitForPanel(port);
  if (ok) {
    spawn('cmd', ['/c', 'start', '', `http://localhost:${port}`], { detached: true, stdio: 'ignore', shell: true }).unref();
  } else {
    console.log('El bot se actualizo, pero el panel local no respondio en 30s. Revisa bot-out.log.');
  }
}

async function main() {
  console.log('');
  console.log('Goloso WhatsApp Bot - actualizacion sin QR');
  console.log('Este proceso conserva config.json y auth_state para no volver a vincular WhatsApp.');

  let targetDir = '';
  if (targetPath) {
    if (!exists(targetPath)) {
      console.log(`La ruta indicada no existe: ${targetPath}`);
      process.exit(4);
    }
    targetDir = fs.realpathSync(targetPath);
    if (path.basename(targetDir).toLowerCase() === 'auth_state') targetDir = path.dirname(targetDir);
  } else {
    targetDir = findInstalledBotFolder();
  }

  if (!targetDir) {
    console.log('No se encontro automaticamente la carpeta anterior del bot.');
    process.exit(2);
  }

  const releaseManifest = await validateSourcePackageAgainstManifest();
  const expected = String(releaseManifest.version || readExpectedVersion()).trim();

  console.log(`Carpeta detectada: ${targetDir}`);
  if (!exists(path.join(targetDir, 'config.json'))) {
    console.log('[ERROR] La carpeta detectada no tiene config.json; no es seguro actualizar porque no se puede identificar la sede.');
    process.exit(2);
  }
  const persistentAuthDir = persistentAuthDirFor(targetDir);
  let hasLegacyAuth = hasUsableAuthState(path.join(targetDir, 'auth_state'));
  let hasPersistentAuth = hasUsableAuthState(persistentAuthDir);
  if (!hasLegacyAuth && !hasPersistentAuth) {
    console.log('No se encontro sesion dentro de la carpeta detectada; buscando auth_state en otras ubicaciones del PC...');
    if (recoverAuthStateFromOtherFolder(targetDir)) {
      hasLegacyAuth = hasUsableAuthState(path.join(targetDir, 'auth_state'));
      hasPersistentAuth = hasUsableAuthState(persistentAuthDir);
    }
  }
  if (!hasLegacyAuth && !hasPersistentAuth) {
    console.log('AVISO: No se encontro una sesion WhatsApp previa (ni auth_state ni sesion persistente).');
    if (autoFromInstaller) process.exit(3);
    if (!force) {
      console.log('Este PC no tiene una sesion de WhatsApp previa que conservar.');
      console.log('Cancelando actualizacion sin QR. Usa install-windows.bat para instalacion nueva.');
      process.exit(3);
    }
    console.log('Continuando por --force. Es posible que WhatsApp pida QR.');
  } else if (hasPersistentAuth) {
    console.log(`Sesion WhatsApp persistente detectada: ${persistentAuthDir}`);
  } else {
    console.log('Sesion WhatsApp antigua detectada en auth_state; se migrara a almacenamiento persistente protegido.');
  }

  const canonicalTargetDir = canonicalInstallDirFor(targetDir);
  const relatedDirs = findRelatedBotFolders(targetDir);
  fs.mkdirSync(canonicalTargetDir, { recursive: true });
  if (!exists(path.join(canonicalTargetDir, 'config.json'))) {
    fs.copyFileSync(path.join(targetDir, 'config.json'), path.join(canonicalTargetDir, 'config.json'));
  }
  console.log(`Carpeta estable de arranque: ${canonicalTargetDir}`);
  if (relatedDirs.length > 1) {
    console.log('Carpetas relacionadas que quedaran neutralizadas/actualizadas:');
    for (const folder of relatedDirs) console.log(` - ${folder}`);
  }

  const backupDir = path.join(canonicalTargetDir, `backup-before-update-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (exists(path.join(targetDir, 'config.json'))) fs.copyFileSync(path.join(targetDir, 'config.json'), path.join(backupDir, 'config.json'));
  preserveAuthState(targetDir, backupDir);

  stopCurrentBot(targetDir);
  const dirsToUpdate = [...new Set([canonicalTargetDir, targetDir, ...relatedDirs].map(resolveFolder).filter(Boolean))];
  for (const dir of dirsToUpdate) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!exists(path.join(dir, 'config.json'))) fs.copyFileSync(path.join(targetDir, 'config.json'), path.join(dir, 'config.json'));
      copyBotFiles(dir);
      updateConfig(dir);
      restoreAuthStateIfMissing(dir, backupDir);
      writeInstallManifest(dir, targetDir);
    } catch (e) {
      console.log(`AVISO: No se pudo actualizar carpeta secundaria ${dir}: ${e?.message || e}`);
    }
  }

  if (!verifyFilesVersion(expected, canonicalTargetDir)) {
    console.log(`[ERROR] La carpeta estable no quedo con archivos version ${expected}.`);
    process.exit(5);
  }

  ensureDependencies(canonicalTargetDir);
  registerStartup(canonicalTargetDir);
  await startBot(canonicalTargetDir);

  const versionOk = await verifyInstalledVersion(expected, canonicalTargetDir, inferPortFromFolder(canonicalTargetDir));

  console.log('');
  if (versionOk) {
    console.log(`Actualizacion completa. Version activa: ${expected}`);
    console.log(`Arranque permanente corregido: Windows iniciara desde ${canonicalTargetDir}`);
    console.log('No se borro la sesion de WhatsApp. La nueva version usa almacenamiento persistente protegido para no pedir QR en futuras actualizaciones.');
  } else {
    console.log('[ERROR] La actualizacion NO quedo aplicada. Vuelve a ejecutar el actualizador como Administrador.');
    process.exit(5);
  }
}

main().catch((error) => {
  console.error('[ERROR]', error?.message || error);
  process.exit(1);
});