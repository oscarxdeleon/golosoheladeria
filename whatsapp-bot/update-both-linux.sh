#!/usr/bin/env bash
set -Eeuo pipefail

BOT_VERSION="8.20.5"
BASE_URL="https://golosoheladeria.lovable.app"
UPDATE_URL="${BASE_URL}/downloads/update-linux.sh?v=${BOT_VERSION}"
ZIP_URL="${BASE_URL}/downloads/golosito-v8.20.5.zip"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Falta instalar '$1' en este servidor." >&2
    exit 1
  fi
}

need_cmd node
need_cmd pm2
need_cmd curl

tmp_script="$(mktemp)"
cleanup() { rm -f "${tmp_script}"; }
trap cleanup EXIT

echo "🍨 Goloso WhatsApp Bot — actualización definitiva ambas sedes"
echo "   Versión objetivo: ${BOT_VERSION}"
echo "   ZIP versionado  : ${ZIP_URL}"
echo ""

curl -fsSL "${UPDATE_URL}" -o "${tmp_script}"
chmod +x "${tmp_script}"

mapfile -t targets < <(pm2 jlist 2>/dev/null | node - <<'NODE'
const fs = require('fs');
let list = [];
try { list = JSON.parse(fs.readFileSync(0, 'utf8') || '[]'); } catch {}
const wanted = [];
for (const p of list) {
  const name = String(p.name || '');
  if (!/goloso-(santa|parque)/i.test(name)) continue;
  const cwd = p.pm2_env?.pm_cwd || p.pm2_env?.PWD || '';
  const script = p.pm2_env?.pm_exec_path || '';
  const dir = cwd || (script ? require('path').dirname(script) : '');
  if (dir) wanted.push(`${name}\t${dir}`);
}
for (const row of wanted) console.log(row);
NODE
)

add_fallback() {
  local name="$1"
  local dir="$2"
  if [[ -f "${dir}/config.json" ]]; then
    for row in "${targets[@]:-}"; do
      if [[ "${row}" == "${name}"$'\t'* || "${row}" == *$'\t'"${dir}" ]]; then
        return 0
      fi
    done
    targets+=("${name}"$'\t'"${dir}")
  fi
}

add_fallback "goloso-santa" "/opt/goloso/sede1"
add_fallback "goloso-parque" "/opt/goloso/sede2"
add_fallback "goloso-santa" "/root/goloso-santa"
add_fallback "goloso-parque" "/root/goloso-parque"

if [[ "${#targets[@]}" -eq 0 ]]; then
  echo "[ERROR] No encontré procesos goloso-santa/goloso-parque ni carpetas conocidas con config.json." >&2
  echo "        Ejecuta: pm2 list" >&2
  exit 2
fi

echo "Sedes detectadas:"
for row in "${targets[@]}"; do
  name="${row%%$'\t'*}"
  dir="${row#*$'\t'}"
  echo " - ${name}: ${dir}"
done
echo ""

for row in "${targets[@]}"; do
  name="${row%%$'\t'*}"
  dir="${row#*$'\t'}"
  echo "========================================"
  echo "Actualizando ${name} en ${dir}"
  echo "========================================"
  GOLOSO_BOT_ZIP_URL="${ZIP_URL}" bash "${tmp_script}" "${dir}" "${name}"
done

echo ""
echo "✅ Listo. Verifica con:"
echo "   curl -s http://localhost:8791/status.json | grep version"
echo "   curl -s http://localhost:8792/status.json | grep version"
echo "   pm2 list"