@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Actualizador Windows
REM  Actualiza el bot sin borrar config.json ni auth_state.
REM ============================================================
setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell no esta disponible en este Windows.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-windows.ps1"
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