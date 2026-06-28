#!/usr/bin/env bash
# Instalador del servidor de impresion Goloso para Linux.
# Crea un servicio systemd que arranca el servidor con el sistema.

set -e
cd "$(dirname "$0")"
DIR="$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no esta instalado. Instala Node 18+ y reintenta."
  exit 1
fi

echo "Instalando dependencias..."
npm install

SERVICE=/etc/systemd/system/goloso-print.service
echo "Creando servicio systemd en $SERVICE (requiere sudo)..."
sudo tee "$SERVICE" > /dev/null <<EOF
[Unit]
Description=Goloso Print Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/server.js
Environment=PORT=3001
Environment=PRINTER_TYPE=usb
# Para impresora de red, comenta la linea anterior y descomenta:
# Environment=PRINTER_TYPE=network
# Environment=PRINTER_IP=192.168.1.50
# Environment=PRINTER_PORT=9100
Restart=on-failure
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable goloso-print.service
sudo systemctl restart goloso-print.service

echo
echo "=== Servicio instalado y corriendo ==="
echo "Verifica con: systemctl status goloso-print"
echo "Logs:        journalctl -u goloso-print -f"
