param(
  [switch]$AutoFromInstaller,
  [string]$TargetPath = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalPort = 8790

function Write-Step($text) {
  Write-Host ""
  Write-Host "== $text ==" -ForegroundColor Cyan
}

function Resolve-StartHiddenFolderFromValue($value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  $match = [regex]::Match($value, '"([^"]*start-hidden\.vbs)"')
  if ($match.Success) { return Split-Path -Parent $match.Groups[1].Value }
  $match = [regex]::Match($value, '([^\s"]*start-hidden\.vbs)')
  if ($match.Success) { return Split-Path -Parent $match.Groups[1].Value }
  return $null
}

function Test-ValidBotFolder($folder) {
  if ([string]::IsNullOrWhiteSpace($folder) -or -not (Test-Path $folder)) { return $false }
  return (Test-Path (Join-Path $folder "config.json")) -or (Test-Path (Join-Path $folder "auth_state")) -or (Test-Path (Join-Path $folder "server.js"))
}

function Find-InstalledBotFolder {
  $candidates = New-Object System.Collections.Generic.List[string]

  try {
    $run = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "GolosoWhatsAppBot" -ErrorAction SilentlyContinue
    $folder = Resolve-StartHiddenFolderFromValue $run.GolosoWhatsAppBot
    if ($folder) { $candidates.Add($folder) }
  } catch {}

  try {
    $startup = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startup "Goloso WhatsApp Bot.lnk"
    if (Test-Path $lnk) {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($lnk)
      $folder = Resolve-StartHiddenFolderFromValue $shortcut.Arguments
      if (-not $folder -and $shortcut.WorkingDirectory) { $folder = $shortcut.WorkingDirectory }
      if ($folder) { $candidates.Add($folder) }
    }
  } catch {}

  if ((Test-Path (Join-Path $SourceDir "config.json")) -or (Test-Path (Join-Path $SourceDir "auth_state"))) {
    $candidates.Add($SourceDir)
  }

  $commonRoots = @(
    (Join-Path ([Environment]::GetFolderPath("ProgramFiles")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Documents\Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Goloso WhatsApp Bot")
  )
  foreach ($root in $commonRoots) { $candidates.Add($root) }

  foreach ($candidate in $candidates) {
    if (Test-ValidBotFolder $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  return $null
}

function Stop-CurrentBot {
  Write-Step "Cerrando bot anterior"
  try {
    $lines = netstat -ano | Select-String ":$LocalPort\s" | Select-String "LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
      $pidValue = $parts[-1]
      if ($pidValue -match '^\d+$') {
        Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  Start-Sleep -Seconds 2
}

function Copy-BotFiles($target) {
  Write-Step "Actualizando archivos del bot"
  $files = @(
    "server.js",
    "setup.js",
    "install-windows.bat",
    "update-windows.bat",
    "update-windows.ps1",
    "ACTUALIZAR-SIN-QR.bat",
    "start-hidden.vbs",
    "uninstall-windows.bat",
    "README.md",
    "package.json",
    "package-lock.json"
  )
  foreach ($file in $files) {
    $src = Join-Path $SourceDir $file
    if (Test-Path $src) {
      $dest = Join-Path $target $file
      if ((Resolve-Path $src).Path -ne (Resolve-Path -LiteralPath $dest -ErrorAction SilentlyContinue).Path) {
        Copy-Item $src -Destination $dest -Force
      }
    }
  }
}

function Update-Config($target) {
  $configPath = Join-Path $target "config.json"
  if (-not (Test-Path $configPath)) {
    Write-Host "No se encontro config.json en la instalacion anterior. Si es una instalacion nueva, ejecuta install-windows.bat." -ForegroundColor Yellow
    return
  }
  $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
  $cfg | Add-Member -NotePropertyName apiUrl -NotePropertyValue "https://golosoheladeria.vercel.app" -Force
  $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
}

function Ensure-Dependencies($target) {
  if (Test-Path (Join-Path $target "node_modules\@whiskeysockets\baileys")) { return }
  $sourceModules = Join-Path $SourceDir "node_modules"
  if (Test-Path (Join-Path $sourceModules "@whiskeysockets\baileys")) {
    Write-Step "Copiando dependencias incluidas"
    Copy-Item $sourceModules -Destination (Join-Path $target "node_modules") -Recurse -Force
    return
  }
  Write-Step "Instalando dependencias faltantes"
  Push-Location $target
  try {
    npm install --omit=dev --no-audit --no-fund
  } finally {
    Pop-Location
  }
}

function Register-Startup($target) {
  Write-Step "Registrando inicio automatico"
  $startup = [Environment]::GetFolderPath("Startup")
  $lnkPath = Join-Path $startup "Goloso WhatsApp Bot.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = "wscript.exe"
  $shortcut.Arguments = "`"$(Join-Path $target "start-hidden.vbs")`""
  $shortcut.WorkingDirectory = $target
  $shortcut.WindowStyle = 7
  $shortcut.IconLocation = "wscript.exe, 0"
  $shortcut.Description = "Goloso WhatsApp Bot"
  $shortcut.Save()

  $runValue = "wscript.exe `"$(Join-Path $target "start-hidden.vbs")`""
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "GolosoWhatsAppBot" -Value $runValue -PropertyType String -Force | Out-Null
}

function Start-Bot($target) {
  Write-Step "Iniciando bot actualizado"
  Start-Process -FilePath "wscript.exe" -ArgumentList "//nologo `"$(Join-Path $target "start-hidden.vbs")`"" -WorkingDirectory $target | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing "http://localhost:$LocalPort/status.json" -TimeoutSec 1 | Out-Null
      $ok = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if ($ok) {
    Start-Process "http://localhost:$LocalPort" | Out-Null
  } else {
    Write-Host "El bot se actualizo, pero el panel local no respondio en 30s. Revisa bot-out.log." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Goloso WhatsApp Bot — actualizacion sin QR" -ForegroundColor Green
Write-Host "Este proceso conserva config.json y auth_state para no volver a vincular WhatsApp."

$TargetDir = Find-InstalledBotFolder
if (-not $TargetDir) {
  if ($AutoFromInstaller) {
    Write-Host "No se encontro instalacion anterior para actualizar automaticamente." -ForegroundColor Yellow
    exit 2
  }
  Write-Host ""
  Write-Host "No pude encontrar automaticamente la carpeta anterior del bot." -ForegroundColor Yellow
  $manual = Read-Host "Pega la ruta de la carpeta donde estaba instalado el bot anterior"
  if ([string]::IsNullOrWhiteSpace($manual) -or -not (Test-Path $manual)) {
    throw "Ruta invalida. Ejecuta este actualizador de nuevo y pega la carpeta correcta."
  }
  $TargetDir = (Resolve-Path $manual).Path
}

Write-Host "Carpeta detectada: $TargetDir"
if (-not (Test-Path (Join-Path $TargetDir "auth_state"))) {
  Write-Host "AVISO: No se encontro auth_state en esa carpeta. Si WhatsApp ya estaba vinculado, revisa que sea la carpeta correcta." -ForegroundColor Yellow
  if ($AutoFromInstaller) { exit 3 }
  $answer = Read-Host "Continuar de todos modos? (S/N)"
  if ($answer -notmatch '^[sS]') { throw "Actualizacion cancelada." }
}

$backupDir = Join-Path $TargetDir ("backup-before-update-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path (Join-Path $TargetDir "config.json")) { Copy-Item (Join-Path $TargetDir "config.json") -Destination $backupDir -Force }
if (Test-Path (Join-Path $TargetDir "auth_state")) { Copy-Item (Join-Path $TargetDir "auth_state") -Destination $backupDir -Recurse -Force }

Stop-CurrentBot
Copy-BotFiles $TargetDir
Update-Config $TargetDir
Ensure-Dependencies $TargetDir
Register-Startup $TargetDir
Start-Bot $TargetDir

Write-Host ""
Write-Host "✅ Actualizacion completa." -ForegroundColor Green
Write-Host "No se borro auth_state. Si la sesion seguia activa en WhatsApp, no necesitas escanear QR."