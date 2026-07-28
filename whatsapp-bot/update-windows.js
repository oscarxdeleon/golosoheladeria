import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PORTS = Array.from({ length: 21 }, (_, index) => 8790 + index);
const API_URL = 'https://golosoheladeria.lovable.app';

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
  return exists(path.join(folder, 'config.json')) || exists(path.join(folder, 'auth_state')) || exists(path.join(folder, 'server.js'));
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

function findReusableAuthState(target) {
  const targetLegacyAuth = resolveFolder(path.join(target, 'auth_state'));
  const targetPersistentAuth = resolveFolder(persistentAuthDirFor(target));
  const results = [];
  for (const root of [...new Set([target, path.dirname(target), ...commonSearchRoots()])]) {
    searchUsableAuthDirs(root, results, 7);
  }

  const unique = [...new Set(results.map(resolveFolder).filter(Boolean))].filter((folder) => {
    if (targetLegacyAuth && folder === targetLegacyAuth) return false;
    if (targetPersistentAuth && folder === targetPersistentAuth) return false;
    return true;
  });

  unique.sort((a, b) => {
    const score = (folder) => {
      let value = 0;
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

function stopCurrentBot(target) {
  step('Cerrando bot anterior');
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

function registerStartup(target) {
  step('Registrando inicio automatico');
  const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const vbsPath = path.join(target, 'start-hidden.vbs');
  const tempVbs = path.join(os.tmpdir(), `goloso_bot_shortcut_${Date.now()}.vbs`);
  const linkPath = path.join(startup, 'Goloso WhatsApp Bot.lnk');
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
  spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'GolosoWhatsAppBot', '/t', 'REG_SZ', '/d', `wscript.exe "${vbsPath}"`, '/f'], { stdio: 'ignore' });
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
  } else {
    targetDir = findInstalledBotFolder();
  }

  if (!targetDir) {
    console.log('No se encontro automaticamente la carpeta anterior del bot.');
    process.exit(2);
  }

  console.log(`Carpeta detectada: ${targetDir}`);
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

  const backupDir = path.join(targetDir, `backup-before-update-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (exists(path.join(targetDir, 'config.json'))) fs.copyFileSync(path.join(targetDir, 'config.json'), path.join(backupDir, 'config.json'));
  preserveAuthState(targetDir, backupDir);

  stopCurrentBot(targetDir);
  copyBotFiles(targetDir);
  updateConfig(targetDir);
  restoreAuthStateIfMissing(targetDir, backupDir);
  ensureDependencies(targetDir);
  registerStartup(targetDir);
  await startBot(targetDir);

  const expected = readExpectedVersion();
  const versionOk = await verifyInstalledVersion(expected, targetDir, inferPortFromFolder(targetDir));

  console.log('');
  if (versionOk) {
    console.log(`Actualizacion completa. Version activa: ${expected}`);
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