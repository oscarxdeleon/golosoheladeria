import { createFileRoute } from "@tanstack/react-router";
import { BOT_DOWNLOAD_SHA256, BOT_DOWNLOAD_URL, BOT_VERSION } from "@/lib/bot-version";

function safeBatchValue(value: string) {
  return value.replace(/[\r\n"]/g, "").trim();
}

function installerBatch(token: string) {
  const expectedVersion = safeBatchValue(BOT_VERSION);
  const expectedSha = safeBatchValue(BOT_DOWNLOAD_SHA256);
  const zipUrl = `https://golosoheladeria.lovable.app${BOT_DOWNLOAD_URL}`;
  return `@echo off
setlocal EnableExtensions
set "GOLOSO_BRANCH_TOKEN=${safeBatchValue(token)}"
set "EXPECTED_VERSION=${expectedVersion}"
set "EXPECTED_SHA256=${expectedSha}"
set "ZIP_URL=${zipUrl}"
set "WORK=%TEMP%\\golosito-one-click-%RANDOM%-%RANDOM%"
set "LOGROOT=%LOCALAPPDATA%\\GolositoBot\\logs"
if not exist "%LOGROOT%" mkdir "%LOGROOT%" >nul 2>nul
set "LOG=%LOGROOT%\\one-click-install.log"

echo Descargando...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force -Path $env:WORK | Out-Null; Invoke-WebRequest -UseBasicParsing -Uri $env:ZIP_URL -Headers @{'Cache-Control'='no-cache';'Pragma'='no-cache'} -OutFile (Join-Path $env:WORK 'golosito.zip') -TimeoutSec 120" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail

echo Cerrando version anterior...
echo Eliminando archivos antiguos...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $env:WORK 'golosito.zip')).Hash.ToLowerInvariant(); if($hash -ne ($env:EXPECTED_SHA256).ToLowerInvariant()){ throw ('hash invalido ' + $hash) }; Expand-Archive -LiteralPath (Join-Path $env:WORK 'golosito.zip') -DestinationPath (Join-Path $env:WORK 'pkg') -Force" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail

echo Instalando...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $pkg=Join-Path $env:WORK 'pkg'; $installer=Get-ChildItem -LiteralPath $pkg -Filter 'goloso-bot-installer.js' -Recurse | Select-Object -First 1; if(-not $installer){ throw 'instalador no encontrado' }; $dir=$installer.DirectoryName; $pkgJson=Get-Content -Raw -LiteralPath (Join-Path $dir 'package.json') | ConvertFrom-Json; if([string]$pkgJson.version -ne $env:EXPECTED_VERSION){ throw ('version paquete invalida ' + [string]$pkgJson.version) }; Push-Location $dir; try { node goloso-bot-installer.js --expected $env:EXPECTED_VERSION } finally { Pop-Location }" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail

echo Verificando...
echo Instalacion completada correctamente.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath $env:WORK -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>nul
endlocal
exit /b 0

:fail
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath $env:WORK -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>nul
echo No se pudo completar la instalacion. El detalle quedo guardado en el archivo de logs.
endlocal
exit /b 1
`;
}

export const Route = createFileRoute("/downloads/instalar-actualizar-golosito.bat")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        return new Response(installerBatch(token), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="instalar-actualizar-golosito.bat"',
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
          },
        });
      },
    },
  },
});