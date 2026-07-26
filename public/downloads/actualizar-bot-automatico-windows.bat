@echo off
setlocal EnableExtensions
title Goloso - Actualizador automatico del bot

echo.
echo ============================================================
echo   Goloso WhatsApp Bot - Actualizador automatico
echo ============================================================
echo.
echo Este asistente entra al servidor por SSH y actualiza el bot
echo automaticamente sin copiar ni pegar comandos.
echo.
echo Necesitas:
echo  - IP del Droplet/servidor
echo  - Contrasena de root del servidor
echo.

where ssh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Este Windows no tiene el cliente SSH instalado.
  echo Instala/activa OpenSSH Client o abre esta app desde Windows 10/11 actualizado.
  echo.
  pause
  exit /b 1
)

set "SERVER_IP="
set /p SERVER_IP=Escribe la IP del servidor y presiona ENTER: 
if not defined SERVER_IP (
  echo.
  echo No ingresaste IP. No se hizo ningun cambio.
  pause
  exit /b 1
)

echo.
echo Conectando a root@%SERVER_IP% ...
echo Si pregunta "Are you sure you want to continue connecting", escribe yes.
echo Luego escribe la contrasena del servidor.
echo.

ssh -o StrictHostKeyChecking=accept-new -t root@%SERVER_IP% "curl -fsSL https://golosoheladeria.lovable.app/downloads/update-both-linux.sh | bash"
set "EC=%ERRORLEVEL%"

echo.
if "%EC%"=="0" (
  echo ✅ Actualizacion finalizada. Vuelve al panel y presiona "Verificar version ahora".
) else (
  echo [ERROR] La actualizacion no finalizo correctamente. Codigo: %EC%
  echo Si ves un mensaje de permiso o contrasena, revisa la IP y la clave del servidor.
)
echo.
pause
exit /b %EC%