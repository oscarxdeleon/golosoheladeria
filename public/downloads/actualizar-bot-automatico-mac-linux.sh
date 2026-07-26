#!/usr/bin/env bash
set -Eeuo pipefail

echo ""
echo "============================================================"
echo "  Goloso WhatsApp Bot - Actualizador automatico"
echo "============================================================"
echo ""
echo "Este asistente entra al servidor por SSH y actualiza el bot"
echo "automaticamente sin copiar ni pegar comandos."
echo ""
echo "Necesitas la IP del Droplet/servidor y la contraseña de root."
echo ""

if ! command -v ssh >/dev/null 2>&1; then
  echo "[ERROR] Este equipo no tiene el cliente SSH instalado."
  exit 1
fi

read -r -p "Escribe la IP del servidor y presiona ENTER: " SERVER_IP
if [[ -z "${SERVER_IP}" ]]; then
  echo "No ingresaste IP. No se hizo ningun cambio."
  exit 1
fi

echo ""
echo "Conectando a root@${SERVER_IP} ..."
echo "Si pregunta 'Are you sure you want to continue connecting', escribe yes."
echo "Luego escribe la contraseña del servidor."
echo ""

ssh -o StrictHostKeyChecking=accept-new -t "root@${SERVER_IP}" 'curl -fsSL https://golosoheladeria.lovable.app/downloads/update-both-linux.sh | bash'

echo ""
echo "✅ Si no apareció error, vuelve al panel y presiona 'Verificar versión ahora'."