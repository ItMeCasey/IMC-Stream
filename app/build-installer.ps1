# Builds the Windows installer. Run:  powershell -ExecutionPolicy Bypass -File build-installer.ps1 [-Pack]
#   (no switch) -> app\dist\ItMeCasey Stream Setup <version>.exe     -Pack -> app\dist\win-unpacked\ (portable folder, no installer)
# It stages a copy of the pack on your local disk first (%LOCALAPPDATA%\ItMeCaseyBuild): cloud-synced folders such as
# Google Drive "Other computers" corrupt npm installs. Needs Node.js 22+ and an internet connection the first time.
param([switch]$Pack)
$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot; $root = Split-Path -Parent $app
$stage = Join-Path $env:LOCALAPPDATA 'ItMeCaseyBuild'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js is required: https://nodejs.org'; exit 1 }
New-Item -ItemType Directory -Force $stage | Out-Null

function Mirror($from, $to, $xd) {
  $args2 = @($from, $to, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:2')
  if ($xd) { $args2 += '/XD'; $args2 += $xd }
  robocopy @args2 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $from" }
}
Write-Host 'Copying files to a local build folder...'
Mirror $app (Join-Path $stage 'app') @('node_modules', 'dist')
Mirror (Join-Path $root 'server') (Join-Path $stage 'server') @('kokoro', 'data', 'node_modules')
foreach ($d in 'overlays', 'assets', 'sounds', 'transitions') { Mirror (Join-Path $root $d) (Join-Path $stage $d) $null }

Push-Location (Join-Path $stage 'app')
try {
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  if (-not (Test-Path 'node_modules\electron-builder')) { Write-Host 'Installing build tools (first time only, a few minutes)...'; npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
  Write-Host 'Building...'
  if ($Pack) { npx electron-builder --win --dir } else { npx electron-builder --win nsis }
  if ($LASTEXITCODE) { throw 'electron-builder failed' }
  $out = Join-Path $app 'release'; New-Item -ItemType Directory -Force $out | Out-Null
  if ($Pack) { Mirror (Join-Path $stage 'app\dist\win-unpacked') (Join-Path $out 'win-unpacked') $null }
  else { Copy-Item (Join-Path $stage 'app\dist\*.exe') $out -Force; Copy-Item (Join-Path $stage 'app\dist\*.blockmap') $out -Force -ErrorAction SilentlyContinue }
  Write-Host "Done: $out"
} finally { Pop-Location }
