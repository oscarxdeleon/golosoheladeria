@echo off
REM Inicia el servidor de impresion Goloso en segundo plano.
REM Edita las variables de abajo si tu impresora es de red.

cd /d "%~dp0"

REM === Configuracion de la impresora ===
REM PRINTER_TYPE=usb  -> impresora conectada por USB (default)
REM PRINTER_TYPE=network y define PRINTER_IP / PRINTER_PORT
set PRINTER_TYPE=usb
REM set PRINTER_TYPE=network
REM set PRINTER_IP=192.168.1.50
REM set PRINTER_PORT=9100
set PORT=3001

echo Iniciando Goloso Print Server en http://localhost:%PORT% ...
node server.js
