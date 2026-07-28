@echo off
REM ============================================================
REM  Goloso WhatsApp Bot - Actualizador Windows REMOTO
REM  Descarga SIEMPRE la ultima version publicada desde la nube,
REM  la extrae en una carpeta temporal y ejecuta el actualizador
REM  desde esa carpeta (asi los archivos nuevos SI reemplazan
REM  los viejos). Al terminar, verifica que la version activa
REM  coincida con la esperada.
REM ============================================================
setlocal EnableExtensions
title Goloso - Actualizador remoto del Bot Windows

set "BASE_URL=https://golosoheladeria.lovable.app"
set "MANIFEST_URL=%BASE_URL%/downloads/manifest.json"
set "VERSION="
set "URL="
set "PRIMARY_URL=https://golosoheladeria.lovable.app/downloads/golosito.zip"
set "FALLBACK_URL=https://golosoheladeria.lovable.app/downloads/whatsapp-bot.zip"
set "EXPECTED_SHA256=d8abbe59ab2c555dcd089a343e6efe7969da54f380a494445a9aa2c259e77ee9"
set "STAMP=%DATE%_%TIME%"
set "STAMP=%STAMP: =0%"
set "STAMP=%STAMP:/=%"
set "STAMP=%STAMP::=%"
set "STAMP=%STAMP:.=%"
set "STAMP=%STAMP:,=%"
set "TMPDIR=%TEMP%\goloso-bot-update-%STAMP%"
set "MANIFEST=%TMPDIR%\manifest.json"
set "ZIP=%TMPDIR%\golosito.zip"
set "EXTRACT=%TMPDIR%\extract"
set "TARGET="

echo.
echo ============================================================
echo  Goloso WhatsApp Bot - actualizacion remota
echo ============================================================
echo.
echo Descargando instalador estable desde la nube.
echo   %PRIMARY_URL%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado en este PC.
  echo Instala Node 18+ desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

mkdir "%TMPDIR%" >nul 2>nul
mkdir "%EXTRACT%" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; $headers=@{'Cache-Control'='no-cache';'Pragma'='no-cache'}; $urls=@('%PRIMARY_URL%','%FALLBACK_URL%'); foreach($u in $urls){ try { Write-Host ('Intentando: ' + $u); Invoke-WebRequest -UseBasicParsing -Uri ($u + ($(if($u.Contains('?')){'&'}else{'?'}) + 't=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())) -Headers $headers -MaximumRedirection 5 -OutFile '%ZIP%' -TimeoutSec 90; if((Test-Path '%ZIP%') -and ((Get-Item '%ZIP%').Length -gt 0)){ Set-Content -Path '%TMPDIR%\url.txt' -Value $u -Encoding ASCII; exit 0 } } catch { Write-Host $_.Exception.Message } }; exit 1"
if errorlevel 1 (
  echo [ERROR] No se pudo descargar el ZIP. Revisa la conexion a internet.
  pause
  exit /b 1
)

for %%A in ("%ZIP%") do set "ZIPSIZE=%%~zA"
if "%ZIPSIZE%"=="0" (
  echo [ERROR] El archivo descargado esta vacio.
  pause
  exit /b 1
)
echo Descargado (%ZIPSIZE% bytes).
echo Validando integridad SHA-256...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$expected='%EXPECTED_SHA256%'.ToLowerInvariant(); $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath '%ZIP%').Hash.ToLowerInvariant(); Write-Host ('SHA-256 descargado: ' + $actual); if($actual -ne $expected){ Write-Host ('[ERROR] Integridad invalida. Esperado: ' + $expected); exit 1 }; exit 0"
if errorlevel 1 (
  echo [ERROR] El ZIP descargado no coincide con la version oficial publicada.
  echo Borra el archivo temporal y vuelve a intentar. Si persiste, contacta soporte.
  pause
  exit /b 1
)
echo.
echo Extrayendo en %EXTRACT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%EXTRACT%' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo [ERROR] No se pudo extraer el ZIP.
  pause
  exit /b 1
)

REM Si el ZIP contiene una subcarpeta raiz (ej. whatsapp-bot/), usarla como origen.
set "SRC=%EXTRACT%"
if exist "%EXTRACT%\whatsapp-bot\update-windows.js" set "SRC=%EXTRACT%\whatsapp-bot"
if not exist "%SRC%\update-windows.js" (
  echo [ERROR] El ZIP no contiene update-windows.js. Contacta soporte.
  pause
  exit /b 1
)

for /f "usebackq tokens=2 delims=:," %%V in (`findstr /C:"\"version\"" "%SRC%\package.json"`) do (
  set "EXPECTED=%%~V"
)
set "EXPECTED=%EXPECTED: =%"
set "EXPECTED=%EXPECTED:"=%"
echo Version a instalar: %EXPECTED%
echo.

if "%EXPECTED%"=="" (
  echo [ERROR] No se pudo leer la version del ZIP descargado.
  pause
  exit /b 1
)

echo Consultando manifiesto solo como referencia ^(no bloquea la instalacion^) ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; $headers=@{'Cache-Control'='no-cache';'Pragma'='no-cache'}; try { Invoke-WebRequest -UseBasicParsing -Uri ('%MANIFEST_URL%?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Headers $headers -OutFile '%MANIFEST%' -TimeoutSec 20; $m=Get-Content '%MANIFEST%' -Raw | ConvertFrom-Json; if($m.version){ Write-Host ('Version informada por manifiesto: ' + $m.version) }; exit 0 } catch { Write-Host 'Manifiesto no disponible o atrasado; se continua con el ZIP descargado.'; exit 0 }"
echo.

echo Detectando carpeta activa del bot instalado...
for /f "usebackq delims=" %%T in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=8790..8810; foreach($p in $ports){ try { $s=Invoke-RestMethod -UseBasicParsing -Uri ('http://localhost:'+$p+'/status.json') -TimeoutSec 2; if($s.folder -and (Test-Path -LiteralPath $s.folder)){ Write-Output $s.folder; exit 0 } } catch {} }; exit 0"`) do (
  if not defined TARGET set "TARGET=%%T"
)
if defined TARGET (
  echo Carpeta activa detectada: %TARGET%
) else (
  echo No se detecto panel local activo; el actualizador hara busqueda profunda.
)
echo.

pushd "%SRC%"
if defined TARGET (
  node "%SRC%\update-windows.js" --target "%TARGET%" --force --skip-manifest
) else (
  node "%SRC%\update-windows.js" --force --skip-manifest
)
set "EC=%ERRORLEVEL%"
popd

echo.
if "%EC%"=="0" (
  echo ============================================================
  echo  Actualizacion aplicada correctamente. Version activa: %EXPECTED%
  echo ============================================================
) else (
  echo ============================================================
  echo  [ERROR] La actualizacion NO quedo aplicada. Codigo: %EC%
  echo  Ejecuta este archivo otra vez como Administrador
  echo  (clic derecho ^> Ejecutar como administrador).
  echo ============================================================
)
echo.
pause
exit /b %EC%
