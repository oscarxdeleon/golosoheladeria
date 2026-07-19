@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Actualizar sin volver a vincular QR
REM  Usa este archivo si el bot ya estaba conectado en este PC.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: actualizar SIN QR ===
echo.
echo Este actualizador conserva:
echo   - config.json  ^(token actual^)
echo   - auth_state\  ^(sesion de WhatsApp vinculada^)
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell no esta disponible en este Windows.
  pause
  exit /b 1
)

REM --- Intento 1: deteccion automatica ---
echo Buscando la instalacion anterior del bot en este PC...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-windows.ps1"
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
if "%EC%"=="2" (
  echo [AVISO] No se encontro automaticamente la carpeta anterior del bot.
) else if "%EC%"=="3" (
  echo [AVISO] Se encontro una carpeta, pero no tiene la sesion 'auth_state'.
) else (
  echo [AVISO] La actualizacion automatica no se pudo completar ^(codigo %EC%^).
)

echo.
echo Puedes indicar manualmente la carpeta donde estaba instalado el bot.
echo Ejemplo: C:\GolosoBot   o   C:\Users\TuUsuario\Desktop\Goloso WhatsApp Bot
echo.
set "MANUAL="
set /p MANUAL=Pega la ruta completa de la carpeta anterior ^(o ENTER para cancelar^): 

if not defined MANUAL goto :cancel
if "%MANUAL%"=="" goto :cancel

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-windows.ps1" -TargetPath "%MANUAL%" -Force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
echo [ERROR] No se pudo completar la actualizacion sin QR ^(codigo %EC%^).
echo.
echo Causas posibles:
echo   1^) La carpeta indicada no contiene 'auth_state' ^(nunca se vinculo por QR^).
echo   2^) La ruta no existe o esta mal escrita.
echo.
echo Si este PC nunca vinculo WhatsApp, no hay sesion que conservar.
echo En ese caso ejecuta 'install-windows.bat' para hacer una instalacion nueva
echo ^(pedira escanear el QR una sola vez^).
echo.
pause
exit /b %EC%

:cancel
echo.
echo Operacion cancelada por el usuario.
pause
exit /b 1

:done
echo.
echo Listo. El bot fue actualizado conservando la vinculacion de WhatsApp.
pause
endlocal
exit /b 0
