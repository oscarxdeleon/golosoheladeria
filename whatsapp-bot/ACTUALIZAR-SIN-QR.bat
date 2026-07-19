@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Actualizar sin volver a vincular QR
REM  Usa este archivo si el bot ya estaba conectado en este PC.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: actualizar SIN QR ===
echo.
echo Este actualizador conserva:
echo - config.json  ^(token actual^)
echo - auth_state\  ^(sesion de WhatsApp vinculada^)
echo.
echo IMPORTANTE: No uses install-windows.bat si ya tenias el bot conectado.
echo.

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
  echo [ERROR] No se pudo completar la actualizacion sin QR.
  echo Si no existe la carpeta auth_state anterior, no es posible conservar la vinculacion de WhatsApp.
  pause
  exit /b %EC%
)

echo.
echo Listo. El bot fue actualizado conservando WhatsApp vinculado.
pause
endlocal
exit /b 0