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

function Add-CandidateFolder($list, $folder) {
  if ([string]::IsNullOrWhiteSpace($folder)) { return }
  try {
    if (-not (Test-Path -LiteralPath $folder)) { return }
    $resolved = (Resolve-Path -LiteralPath $folder).Path
    if (-not $list.Contains($resolved)) { $list.Add($resolved) }
  } catch {}
}

function Get-BotFolderScore($folder) {
  $score = 0
  if (Test-Path (Join-Path $folder "auth_state")) { $score += 100 }
  if (Test-Path (Join-Path $folder "config.json")) { $score += 80 }
  if (Test-Path (Join-Path $folder "server.js")) { $score += 40 }
  if (Test-Path (Join-Path $folder "start-hidden.vbs")) { $score += 20 }
  if (Test-Path (Join-Path $folder "package.json")) { $score += 10 }
  return $score
}

function Find-FoldersByDeepScan($candidates) {
  Write-Step "Busqueda profunda automatica"
  Write-Host "No necesitas saber la ruta. Estoy revisando Escritorio, Descargas, Documentos, AppData y carpetas comunes..."

  $roots = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("MyDocuments"),
    (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"),
    [Environment]::GetFolderPath("LocalApplicationData"),
    [Environment]::GetFolderPath("ApplicationData"),
    [Environment]::GetFolderPath("ProgramFiles"),
    ${env:ProgramData},
    [Environment]::GetFolderPath("UserProfile")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    try {
      Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules(\\|$)|\\\.git(\\|$)|\\Cache(\\|$)|\\Caches(\\|$)' } |
        Where-Object {
          $_.Name -eq "auth_state" -or
          $_.Name -like "*Goloso*Bot*" -or
          $_.Name -like "*WhatsApp*Bot*" -or
          $_.Name -eq "whatsapp-bot"
        } |
        ForEach-Object {
          if ($_.Name -eq "auth_state") {
            Add-CandidateFolder $candidates $_.Parent.FullName
          } else {
            Add-CandidateFolder $candidates $_.FullName
          }
        }
    } catch {}
  }
}

function Find-InstalledBotFolder {
  $candidates = New-Object System.Collections.Generic.List[string]

  try {
    $processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue
    foreach ($proc in $processes) {
      if ($proc.CommandLine -and $proc.CommandLine -match 'server\.js') {
        $matches = [regex]::Matches($proc.CommandLine, '"([^"]*server\.js)"|([^\s"]*server\.js)')
        foreach ($m in $matches) {
          $serverPath = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
          if ($serverPath) { Add-CandidateFolder $candidates (Split-Path -Parent $serverPath) }
        }
      }
    }
  } catch {}

  try {
    $run = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "GolosoWhatsAppBot" -ErrorAction SilentlyContinue
    $folder = Resolve-StartHiddenFolderFromValue $run.GolosoWhatsAppBot
    if ($folder) { Add-CandidateFolder $candidates $folder }
  } catch {}

  try {
    $startup = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startup "Goloso WhatsApp Bot.lnk"
    if (Test-Path $lnk) {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($lnk)
      $folder = Resolve-StartHiddenFolderFromValue $shortcut.Arguments
      if (-not $folder -and $shortcut.WorkingDirectory) { $folder = $shortcut.WorkingDirectory }
      if ($folder) { Add-CandidateFolder $candidates $folder }
    }
  } catch {}

  if ((Test-Path (Join-Path $SourceDir "config.json")) -or (Test-Path (Join-Path $SourceDir "auth_state"))) {
    Add-CandidateFolder $candidates $SourceDir
  }

  $commonRoots = @(
    (Join-Path ([Environment]::GetFolderPath("ProgramFiles")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Documents\Goloso WhatsApp Bot"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Goloso WhatsApp Bot")
  )
  foreach ($root in $commonRoots) { Add-CandidateFolder $candidates $root }

  Find-FoldersByDeepScan $candidates

  $best = $candidates |
    Where-Object { Test-ValidBotFolder $_ } |
    Sort-Object @{ Expression = { Get-BotFolderScore $_ }; Descending = $true }, @{ Expression = { (Get-Item $_).LastWriteTime }; Descending = $true } |
    Select-Object -First 1

  if ($best) { return (Resolve-Path -LiteralPath $best).Path }

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
    "SOLUCION-SIN-SABER-CARPETA.bat",
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

$TargetDir = $null
if (-not [string]::IsNullOrWhiteSpace($TargetPath)) {
  $TargetPath = $TargetPath.Trim().Trim('"')
  if (-not (Test-Path $TargetPath)) {
    Write-Host "La ruta indicada no existe: $TargetPath" -ForegroundColor Red
    exit 4
  }
  $TargetDir = (Resolve-Path $TargetPath).Path
} else {
  $TargetDir = Find-InstalledBotFolder
}

if (-not $TargetDir) {
  if ($AutoFromInstaller) {
    Write-Host "No se encontro instalacion anterior para actualizar automaticamente." -ForegroundColor Yellow
    exit 2
  }
  Write-Host "No se encontro automaticamente la carpeta anterior del bot." -ForegroundColor Yellow
  exit 2
}

Write-Host "Carpeta detectada: $TargetDir"
if (-not (Test-Path (Join-Path $TargetDir "auth_state"))) {
  Write-Host "AVISO: No se encontro auth_state en esa carpeta." -ForegroundColor Yellow
  if ($AutoFromInstaller) { exit 3 }
  if (-not $Force) {
    Write-Host "Este PC no tiene una sesion de WhatsApp previa que conservar." -ForegroundColor Yellow
    Write-Host "Cancelando actualizacion sin QR. Usa install-windows.bat para una instalacion nueva." -ForegroundColor Yellow
    exit 3
  }
  Write-Host "Continuando por bandera -Force. Es posible que WhatsApp pida QR." -ForegroundColor Yellow
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