@echo off
REM Inicia el servidor de impresion Goloso en segundo plano.
REM Configurado para impresora termica de RED (ESC/POS por TCP raw 9100).

cd /d "%~dp0"

REM === Configuracion de la impresora ===
REM Cambia PRINTER_IP si tu impresora cambia de direccion.
set PRINTER_TYPE=network
set PRINTER_IP=192.168.20.200
set PRINTER_PORT=9100
set PORT=3001

echo Iniciando Goloso Print Server en http://localhost:%PORT% ...
echo Impresora de red: %PRINTER_IP%:%PRINTER_PORT%
node server.js
