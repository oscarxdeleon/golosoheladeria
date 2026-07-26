#!/usr/bin/env bash
set -Eeuo pipefail

BOT_VERSION="8.20.7"
CANONICAL_API_URL="https://golosoheladeria.lovable.app"
PRIMARY_DOWNLOAD_URL="https://golosoheladeria.lovable.app/downloads/golosito-v8.20.7.zip"
FALLBACK_DOWNLOAD_URL="https://golosoheladeria.vercel.app/downloads/golosito-v8.20.7.zip"
DOWNLOAD_URL="${GOLOSO_BOT_ZIP_URL:-${PRIMARY_DOWNLOAD_URL}}"
TARGET_DIR="${1:-$(pwd)}"
PM2_NAME="${2:-${PM2_NAME:-}}"

if [[ -z "${TARGET_DIR}" ]]; then
  echo "[ERROR] Debes indicar la carpeta del bot. Ejemplo: bash update-linux.sh /opt/goloso/sede2 goloso-parque" >&2
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Falta instalar '$1' en este servidor." >&2
    exit 1
  fi
}

need_cmd node
need_cmd npm
need_cmd pm2
need_cmd curl
need_cmd unzip

if [[ -z "${1:-}" && ! -f "${TARGET_DIR}/config.json" ]]; then
  pm2_snapshot="$(mktemp)"
  pm2 jlist > "${pm2_snapshot}" 2>/dev/null || echo "[]" > "${pm2_snapshot}"
  detected="$(PM2_SNAPSHOT="${pm2_snapshot}" node <<'NODE'
const fs = require('fs');
const path = require('path');
let list = [];
try { list = JSON.parse(fs.readFileSync(process.env.PM2_SNAPSHOT, 'utf8') || '[]'); } catch {}
const candidates = [];
for (const p of list) {
  const name = String(p.name || '');
  const cwd = p.pm2_env?.pm_cwd || p.pm2_env?.PWD || '';
  const script = p.pm2_env?.pm_exec_path || '';
  const dir = cwd || (script ? path.dirname(script) : '');
  if (!dir) continue;
  const cfg = path.join(dir, 'config.json');
  const srv = path.join(dir, 'server.js');
  if (!fs.existsSync(cfg) || !fs.existsSync(srv)) continue;
  let score = 0;
  if (/goloso|whatsapp|bot|santa|parque|sede/i.test(name)) score += 4;
  if (/goloso|whatsapp|bot|santa|parque|sede/i.test(dir)) score += 3;
  try {
    const cfgJson = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (cfgJson.token && cfgJson.apiUrl) score += 5;
  } catch {}
  try {
    const server = fs.readFileSync(srv, 'utf8');
    if (/BOT_VERSION|Baileys|whatsapp/i.test(server)) score += 5;
  } catch {}
  candidates.push({ name, dir, score });
}
candidates.sort((a, b) => b.score - a.score || a.dir.localeCompare(b.dir));
const pick = candidates[0];
if (pick && pick.score >= 8) console.log(`${pick.dir}\t${pick.name || 'goloso-bot'}`);
NODE
)"
  rm -f "${pm2_snapshot}"
  if [[ -n "${detected}" ]]; then
    TARGET_DIR="${detected%%$'\t'*}"
    detected_name="${detected#*$'\t'}"
    if [[ -z "${PM2_NAME}" ]]; then PM2_NAME="${detected_name}"; fi
    echo "ℹ️ No se indicó carpeta; se detectó automáticamente por PM2: ${TARGET_DIR} (${PM2_NAME})"
  else
    for dir in \
      /root/goloso-parque /root/goloso-santa \
      /opt/goloso/sede2 /opt/goloso/sede1 \
      /opt/goloso-parque /opt/goloso-santa \
      /root/whatsapp-bot /opt/whatsapp-bot \
      /root/goloso /opt/goloso
    do
      if [[ -f "${dir}/config.json" && -f "${dir}/server.js" ]]; then
        TARGET_DIR="${dir}"
        if [[ -z "${PM2_NAME}" ]]; then
          base="$(basename "${dir}" | tr '[:upper:]' '[:lower:]')"
          if [[ "${base}" == *"sede2"* || "${base}" == *"parque"* ]]; then PM2_NAME="goloso-parque";
          elif [[ "${base}" == *"sede1"* || "${base}" == *"santa"* ]]; then PM2_NAME="goloso-santa";
          else PM2_NAME="goloso-bot"; fi
        fi
        echo "ℹ️ No se indicó carpeta; se detectó automáticamente: ${TARGET_DIR}"
        break
      fi
    done
  fi
fi

if [[ -z "${PM2_NAME}" ]]; then
  base="$(basename "${TARGET_DIR}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${base}" == *"sede2"* || "${base}" == *"parque"* ]]; then
    PM2_NAME="goloso-parque"
  elif [[ "${base}" == *"santa"* ]]; then
    PM2_NAME="goloso-santa"
  else
    PM2_NAME="goloso-bot"
  fi
fi

branch_probe="$(printf '%s %s' "${PM2_NAME}" "${TARGET_DIR}" | tr '[:upper:]' '[:lower:]')"
branch_key="generic"
expected_port="8790"
if [[ "${branch_probe}" == *"parque"* || "${branch_probe}" == *"sede2"* ]]; then
  branch_key="parque"
  expected_port="8791"
elif [[ "${branch_probe}" == *"santa"* || "${branch_probe}" == *"sede1"* ]]; then
  branch_key="santa"
  expected_port="8790"
fi

TARGET_DIR="$(mkdir -p "${TARGET_DIR}" && cd "${TARGET_DIR}" && pwd)"
echo ""
echo "🍨 Goloso WhatsApp Bot — actualización Ubuntu/PM2"
echo "   Versión objetivo : ${BOT_VERSION}"
echo "   Carpeta objetivo : ${TARGET_DIR}"
echo "   Proceso PM2      : ${PM2_NAME}"
echo "   Sede detectada   : ${branch_key}"
echo "   Puerto esperado  : ${expected_port}"
echo "   ZIP              : ${DOWNLOAD_URL}"

if [[ ! -f "${TARGET_DIR}/config.json" ]]; then
  echo "[ERROR] No existe config.json en ${TARGET_DIR}. Esa no parece ser la carpeta activa del bot." >&2
  echo "        Revisa con: pm2 describe ${PM2_NAME}" >&2
  exit 2
fi

backup_dir="${TARGET_DIR}/backup-before-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${backup_dir}"
cp -f "${TARGET_DIR}/config.json" "${backup_dir}/config.json"
if [[ -d "${TARGET_DIR}/auth_state" ]]; then
  cp -a "${TARGET_DIR}/auth_state" "${backup_dir}/auth_state"
fi

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "${tmp_dir}"; }
trap cleanup EXIT

echo ""
echo "== Descargando paquete actualizado =="
if ! curl -fL --retry 3 --retry-delay 2 "${DOWNLOAD_URL}" -o "${tmp_dir}/whatsapp-bot.zip"; then
  if [[ "${DOWNLOAD_URL}" != "${FALLBACK_DOWNLOAD_URL}" ]]; then
    echo "⚠️ Descarga principal falló; intentando mirror Vercel…"
    DOWNLOAD_URL="${FALLBACK_DOWNLOAD_URL}"
    curl -fL --retry 3 --retry-delay 2 "${DOWNLOAD_URL}" -o "${tmp_dir}/whatsapp-bot.zip"
  else
    exit 3
  fi
fi
unzip -qo "${tmp_dir}/whatsapp-bot.zip" -d "${tmp_dir}/pkg"

if [[ ! -f "${tmp_dir}/pkg/server.js" ]]; then
  echo "[ERROR] El ZIP descargado no contiene server.js." >&2
  exit 3
fi

downloaded_version="$(grep -Eo 'BOT_VERSION[[:space:]]*=[[:space:]]*"[^"]+"' "${tmp_dir}/pkg/server.js" | head -n1 | sed -E 's/.*"([^"]+)"/\1/')"
if [[ "${downloaded_version}" != "${BOT_VERSION}" ]]; then
  echo "[ERROR] El paquete descargado trae versión ${downloaded_version:-desconocida}, se esperaba ${BOT_VERSION}." >&2
    echo "        URL usada: ${DOWNLOAD_URL}" >&2
    echo "        Puede faltar publicar la app o el CDN aún está sirviendo una versión vieja." >&2
  exit 4
fi

kill_pid_tree() {
  local pid="$1"
  if [[ "${pid}" =~ ^[0-9]+$ && "${pid}" != "$$" ]]; then
    kill -TERM "${pid}" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL "${pid}" >/dev/null 2>&1 || true
  fi
}

kill_port_owner() {
  local port="$1"
  local pids=()
  if command -v fuser >/dev/null 2>&1; then
    mapfile -t pids < <(fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' || true)
  elif command -v lsof >/dev/null 2>&1; then
    mapfile -t pids < <(lsof -ti tcp:"${port}" 2>/dev/null | grep -E '^[0-9]+$' || true)
  elif command -v ss >/dev/null 2>&1; then
    mapfile -t pids < <(ss -ltnp "sport = :${port}" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u || true)
  else
    pids=()
  fi
  for pid in "${pids[@]:-}"; do
    if [[ -n "${pid}" ]]; then
      echo "Deteniendo proceso que ocupaba el puerto ${port}: PID ${pid}"
      kill_pid_tree "${pid}"
    fi
  done
}

echo ""
echo "== Deteniendo procesos viejos de esta sede =="
pm2_json="${tmp_dir}/pm2.json"
pm2 jlist > "${pm2_json}" 2>/dev/null || echo "[]" > "${pm2_json}"
mapfile -t duplicate_pm2_names < <(GOLOSO_TARGET_DIR="${TARGET_DIR}" GOLOSO_PM2_NAME="${PM2_NAME}" GOLOSO_BRANCH_KEY="${branch_key}" GOLOSO_PM2_JSON="${pm2_json}" node <<'NODE'
const fs = require('fs');
const path = require('path');
const targetDir = process.env.GOLOSO_TARGET_DIR;
const targetName = String(process.env.GOLOSO_PM2_NAME || '').toLowerCase();
const targetBranch = String(process.env.GOLOSO_BRANCH_KEY || 'generic').toLowerCase();
const pm2Json = process.env.GOLOSO_PM2_JSON;
let targetToken = '';
try { targetToken = JSON.parse(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8')).token || ''; } catch {}
if (!targetToken) {
  console.error('[ERROR] No se pudo leer token del config.json objetivo; no es seguro detener procesos PM2.');
  process.exit(12);
}
let list = [];
try { list = JSON.parse(fs.readFileSync(pm2Json, 'utf8') || '[]'); } catch {}
const names = new Set();
const resolvedTarget = fs.realpathSync(targetDir);
function classify(value) {
  const s = String(value || '').toLowerCase();
  if (/parque|sede\s*2|sede2/.test(s)) return 'parque';
  if (/santa|sede\s*1|sede1/.test(s)) return 'santa';
  return '';
}
for (const p of list) {
  const name = String(p.name || '');
  const cwd = p.pm2_env?.pm_cwd || p.pm2_env?.PWD || '';
  const script = p.pm2_env?.pm_exec_path || '';
  const dir = cwd || (script ? path.dirname(script) : '');
  let resolvedDir = '';
  try { resolvedDir = dir ? fs.realpathSync(dir) : ''; } catch {}
  let token = '';
  try { token = dir ? JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).token || '' : ''; } catch {}
  const sameDir = resolvedDir && resolvedDir === resolvedTarget;
  const sameToken = token && token === targetToken;
  const sameName = targetName && name.toLowerCase() === targetName;
  const branchMatch = targetBranch !== 'generic' && (classify(name) === targetBranch || classify(dir) === targetBranch);
  if (sameDir || sameToken || sameName || branchMatch) names.add(name || String(p.pm_id));
}
for (const name of names) console.log(name);
NODE
)
for old_name in "${duplicate_pm2_names[@]:-}"; do
  [[ -n "${old_name}" ]] && echo "Eliminando PM2 viejo: ${old_name}" && pm2 delete "${old_name}" >/dev/null 2>&1 || true
done

mapfile -t duplicate_node_pids < <(GOLOSO_TARGET_DIR="${TARGET_DIR}" GOLOSO_BRANCH_KEY="${branch_key}" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const targetDir = process.env.GOLOSO_TARGET_DIR;
const targetBranch = String(process.env.GOLOSO_BRANCH_KEY || 'generic').toLowerCase();
let targetToken = '';
try { targetToken = JSON.parse(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8')).token || ''; } catch {}
let resolvedTarget = '';
try { resolvedTarget = fs.realpathSync(targetDir); } catch {}
function classify(value) {
  const s = String(value || '').toLowerCase();
  if (/parque|sede\s*2|sede2/.test(s)) return 'parque';
  if (/santa|sede\s*1|sede1/.test(s)) return 'santa';
  return '';
}
let rows = '';
try { rows = execSync('ps -eo pid=,args=', { encoding: 'utf8' }); } catch {}
for (const row of rows.split('\n')) {
  if (!/node(\.js)?\b.*server\.js/i.test(row)) continue;
  const match = row.trim().match(/^(\d+)\s+(.*)$/);
  if (!match) continue;
  const pid = Number(match[1]);
  if (!pid || pid === process.pid) continue;
  const args = match[2] || '';
  let cwd = '';
  try { cwd = fs.realpathSync(`/proc/${pid}/cwd`); } catch {}
  let token = '';
  try { token = cwd ? JSON.parse(fs.readFileSync(path.join(cwd, 'config.json'), 'utf8')).token || '' : ''; } catch {}
  const sameDir = cwd && resolvedTarget && cwd === resolvedTarget;
  const sameToken = token && targetToken && token === targetToken;
  const branchMatch = targetBranch !== 'generic' && (classify(cwd) === targetBranch || classify(args) === targetBranch);
  if (sameDir || sameToken || branchMatch) console.log(String(pid));
}
NODE
)
for old_pid in "${duplicate_node_pids[@]:-}"; do
  [[ -n "${old_pid}" ]] && echo "Eliminando node viejo de la sede: PID ${old_pid}" && kill_pid_tree "${old_pid}"
done

kill_port_owner "${expected_port}"

echo ""
echo "== Copiando archivos sin tocar config.json ni auth_state =="
for file in \
  server.js \
  setup.js \
  package.json \
  package-lock.json \
  README.md \
  update-linux.sh \
  start-hidden.vbs \
  install-windows.bat \
  update-windows.bat \
  update-windows.ps1 \
  update-windows.js \
  ACTUALIZAR-SIN-QR.bat \
  SOLUCION-SIN-SABER-CARPETA.bat \
  uninstall-windows.bat
do
  if [[ -f "${tmp_dir}/pkg/${file}" ]]; then
    cp -f "${tmp_dir}/pkg/${file}" "${TARGET_DIR}/${file}"
  fi
done
chmod +x "${TARGET_DIR}/update-linux.sh" || true

echo ""
echo "== Corrigiendo API POS a dominio con Gemini directo =="
GOLOSO_TARGET_DIR="${TARGET_DIR}" GOLOSO_CANONICAL_API_URL="${CANONICAL_API_URL}" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const targetDir = process.env.GOLOSO_TARGET_DIR;
const canonical = process.env.GOLOSO_CANONICAL_API_URL || 'https://golosoheladeria.lovable.app';
if (!targetDir) {
  throw new Error('GOLOSO_TARGET_DIR no definido');
}
const cfgPath = path.join(targetDir, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.apiUrl = canonical;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`apiUrl=${canonical}`);
NODE

echo ""
echo "== Instalando dependencias =="
cd "${TARGET_DIR}"
npm install --omit=dev --no-audit --no-fund
node --check server.js

if ! grep -q "BOT_VERSION = \"${BOT_VERSION}\"" "${TARGET_DIR}/server.js"; then
  echo "[ERROR] server.js no quedó en versión ${BOT_VERSION}." >&2
  exit 5
fi

echo ""
echo "== Reiniciando PM2 desde la carpeta correcta =="
PORT="${expected_port}" pm2 start "${TARGET_DIR}/server.js" --name "${PM2_NAME}" --cwd "${TARGET_DIR}" --update-env
pm2 save >/dev/null 2>&1 || true

echo ""
echo "== Verificación =="
active_version=""
active_json=""
for attempt in $(seq 1 20); do
  sleep 2
  if active_json="$(curl -fsS "http://localhost:${expected_port}/status.json" 2>/dev/null)"; then
    active_version="$(printf '%s' "${active_json}" | sed -nE 's/.*"version":"([^"]+)".*/\1/p')"
    if [[ "${active_version}" == "${BOT_VERSION}" ]]; then
      echo "Panel local: http://localhost:${expected_port}/status.json"
      echo "${active_json}"
      break
    fi
    echo "⚠️ El puerto ${expected_port} respondió v${active_version:-desconocida}; eliminando instancia vieja y reintentando (${attempt}/20)."
    kill_port_owner "${expected_port}"
    PORT="${expected_port}" pm2 restart "${PM2_NAME}" --update-env >/dev/null 2>&1 || PORT="${expected_port}" pm2 start "${TARGET_DIR}/server.js" --name "${PM2_NAME}" --cwd "${TARGET_DIR}" --update-env >/dev/null 2>&1 || true
  else
    PORT="${expected_port}" pm2 restart "${PM2_NAME}" --update-env >/dev/null 2>&1 || true
  fi
done

pm2 logs "${PM2_NAME}" --lines 25 --nostream || true

if [[ "${active_version}" != "${BOT_VERSION}" ]]; then
  echo "[ERROR] La sede sigue reportando v${active_version:-desconocida}; no quedó activa la versión ${BOT_VERSION}." >&2
  echo "        Revisa procesos viejos: pm2 list && ps -ef | grep server.js" >&2
  exit 6
fi

echo ""
echo "== Instalando auto-actualización diaria (cron 4:00 AM) =="
cron_marker="# goloso-auto-update ${PM2_NAME}"
cron_line="0 4 * * * curl -fsSL https://golosoheladeria.lovable.app/downloads/update-linux.sh | bash -s ${TARGET_DIR} ${PM2_NAME} >> /var/log/goloso-${PM2_NAME}-update.log 2>&1 ${cron_marker}"
( crontab -l 2>/dev/null | grep -v "${cron_marker}" ; echo "${cron_line}" ) | crontab -
echo "Cron instalado: se actualizará automáticamente cada día a las 4:00 AM"

echo ""
echo "✅ Actualización completa. Debe verse: Versión : ${BOT_VERSION}"
echo "   Sede ${branch_key} verificada en puerto ${expected_port}."
