@echo off
setlocal EnableExtensions
title Goloso - Actualizar bot Parque (automatico)

REM ============================================================
REM  Actualizador 100%% automatico para sede PARQUE
REM  IP y contrasena ya incluidas. Solo doble clic.
REM ============================================================

set "SERVER_IP=165.227.124.249"
set "SERVER_USER=root"
set "SERVER_PASS=GolosO2027p"
set "REMOTE_CMD=curl -fsSL https://golosoheladeria.lovable.app/downloads/update-both-linux.sh | bash"

set "PLINK=%~dp0plink.exe"

echo.
echo ============================================================
echo   Goloso WhatsApp Bot - Actualizador automatico (Parque)
echo ============================================================
echo.
echo   Servidor : %SERVER_IP%
echo   Usuario  : %SERVER_USER%
echo.
echo   No necesitas escribir IP ni contrasena.
echo.

if not exist "%PLINK%" (
  echo Descargando herramienta SSH ^(plink.exe, ~1MB^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://the.earth.li/~sgtatham/putty/latest/w64/plink.exe' -OutFile '%PLINK%' } catch { exit 1 }"
  if not exist "%PLINK%" (
    echo [ERROR] No se pudo descargar plink.exe. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

echo.
echo Conectando y ejecutando la actualizacion. Esto puede tardar 2-4 minutos...
echo No cierres esta ventana hasta ver "Actualizacion finalizada".
echo.

REM -batch: no pregunta interactivo. Aceptar host key con "y" via echo.
echo y | "%PLINK%" -ssh -pw %SERVER_PASS% %SERVER_USER%@%SERVER_IP% "%REMOTE_CMD%"
set "EC=%ERRORLEVEL%"

echo.
if "%EC%"=="0" (
  echo ============================================================
  echo   Actualizacion finalizada correctamente.
  echo   Vuelve al panel POS y presiona "Verificar version ahora".
  echo ============================================================
) else (
  echo [ERROR] La actualizacion no finalizo correctamente. Codigo: %EC%
  echo Si el problema persiste, avisa al soporte.
)
echo.
pause
exit /b %EC%
