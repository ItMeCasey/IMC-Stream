# Installs the Kokoro realistic voices into server\kokoro (its own folder: nothing else on your PC is touched).
# Needs Python 3.9-3.13 on PATH. Downloads about 120 MB (the compact "int8" model + the voice pack).
# Usage: powershell -File install-kokoro.ps1 [-Fp32] [-Dir <folder>]     (-Fp32 = bigger, slightly higher quality model, 326 MB)
param([switch]$Fp32, [string]$Dir)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$k = if ($Dir) { $Dir } else { Join-Path $here 'kokoro' }; $models = Join-Path $k 'models'; $py = Join-Path $k 'venv\Scripts\python.exe'
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and -not (Test-Path $py)) { Write-Host 'Python is not installed. Get it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.'; exit 1 }
New-Item -ItemType Directory -Force $models | Out-Null
if (-not (Test-Path $py)) { Write-Host 'Creating the Python environment...'; python -m venv (Join-Path $k 'venv') }
Write-Host 'Installing the packages (kokoro-onnx, soundfile)...'
& $py -m pip install --quiet --disable-pip-version-check kokoro-onnx soundfile
if ($LASTEXITCODE -ne 0) { Write-Host 'pip failed (see above).'; exit 1 }
$base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0'
$files = @('voices-v1.0.bin', $(if ($Fp32) { 'kokoro-v1.0.onnx' } else { 'kokoro-v1.0.int8.onnx' }))
foreach ($f in $files) {
  $dest = Join-Path $models $f
  if (Test-Path $dest) { Write-Host "$f is already downloaded."; continue }
  Write-Host "Downloading $f ..."
  Invoke-WebRequest "$base/$f" -OutFile "$dest.part" -UseBasicParsing
  Move-Item "$dest.part" $dest
}
Write-Host ''
Write-Host 'Done. Restart the server, open the Speech page and pick a voice such as af_heart.'
