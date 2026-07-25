@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Actualizador Windows
REM  Actualiza el bot sin borrar config.json ni auth_state.
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado en este Windows.
  echo Descarga Node 18+ desde https://nodejs.org e intenta de nuevo.
  pause
  exit /b 1
)

node "%~dp0update-windows.js"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] No se pudo completar la actualizacion.
  pause
  exit /b %EC%
)

echo.
echo Actualizacion terminada. Puedes cerrar esta ventana.
pause
endlocal
exit /b 0