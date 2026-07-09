@echo off
REM ============================================================
REM  Goloso Print Server - arranque real (impresora ESC/POS)
REM ============================================================
REM  Este .bat lo invoca start-hidden.vbs para que se ejecute en
REM  segundo plano sin ventana de consola visible.
REM ============================================================

cd /d "%~dp0"

REM === Configuracion de la impresora ===
set PRINTER_TYPE=network
set PRINTER_IP=192.168.20.200
set PRINTER_PORT=9100
set PORT=3001

REM Control de instancia unica: si el puerto ya esta ocupado, salir.
REM El instalador detiene versiones anteriores antes de llegar aqui; esta
REM proteccion evita dobles procesos durante el arranque normal de Windows.
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul
if %errorlevel%==0 (
  exit /b 0
)

node server.js
