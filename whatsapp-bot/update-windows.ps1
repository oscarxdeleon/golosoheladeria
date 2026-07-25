param(
  [switch]$AutoFromInstaller,
  [string]$TargetPath = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $dir 'update-windows.js'

if (-not (Test-Path -LiteralPath $script)) {
  Write-Host '[ERROR] Falta update-windows.js en esta carpeta.'
  exit 1
}

$nodeArgs = @($script)
if ($AutoFromInstaller) { $nodeArgs += '--auto-from-installer' }
if (-not [string]::IsNullOrWhiteSpace($TargetPath)) {
  $nodeArgs += '--target'
  $nodeArgs += $TargetPath
}
if ($Force) { $nodeArgs += '--force' }

& node @nodeArgs
exit $LASTEXITCODE