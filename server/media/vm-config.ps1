# Sets up Voicemeeter Banana / Potato through its official Remote API (VoicemeeterRemote64.dll).
# Usage: powershell -File vm-config.ps1 -Kind banana|potato -Mic "device name" -Out "headphones name" [-HearMic]
# Routing it sets: mic -> B1 (stream); Windows default sound (VAIO) -> your headphones + B1 (game, chat, browser); Aux input -> your headphones + B2 (music).
param([string]$Kind = 'banana', [string]$Mic = '', [string]$Out = '', [switch]$HearMic)
$ErrorActionPreference = 'Stop'
$dir = Join-Path ${env:ProgramFiles(x86)} 'VB\Voicemeeter'
$dll = Join-Path $dir 'VoicemeeterRemote64.dll'
if (-not (Test-Path $dll)) { [Console]::Out.WriteLine('{"ok":false,"error":"Voicemeeter is not installed yet (VoicemeeterRemote64.dll missing)"}'); exit 0 }
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VMK { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetDllDirectory(string p); }
public static class VMR {
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_Login();
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_Logout();
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_RunVoicemeeter(int t);
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Unicode)] public static extern int VBVMR_SetParametersW(string s);
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_IsParametersDirty();
}
"@
[void][VMK]::SetDllDirectory($dir)
$potato = ($Kind -eq 'potato')
$vaio = if ($potato) { 5 } else { 3 }; $aux = if ($potato) { 6 } else { 4 }
$clean = { param($s) ($s -replace '["\r\n;]', '').Trim() }
$res = [ordered]@{ ok = $false }
try {
  [void][VMR]::VBVMR_RunVoicemeeter($(if ($potato) { 3 } else { 2 }))
  $login = 1
  for ($i = 0; $i -lt 15 -and $login -ne 0; $i++) { Start-Sleep -Milliseconds 700; $login = [VMR]::VBVMR_Login() }
  if ($login -ne 0) { throw "Could not connect to Voicemeeter (login code $login). Open Voicemeeter once and run this again." }
  Start-Sleep -Milliseconds 800
  $p = New-Object System.Collections.Generic.List[string]
  $mic = & $clean $Mic; $out = & $clean $Out
  if ($mic) { $p.Add("Strip[0].device.wdm=`"$mic`";") }
  $p.Add('Strip[0].B1=1;'); $p.Add('Strip[0].B2=0;'); $p.Add("Strip[0].A1=$(if ($HearMic) { 1 } else { 0 });")
  if ($out) { $p.Add("Bus[0].device.wdm=`"$out`";") }
  $p.Add("Strip[$vaio].A1=1;"); $p.Add("Strip[$vaio].B1=1;"); $p.Add("Strip[$vaio].B2=0;")   # game / chat / browser: you hear it, the stream gets it (and the VOD)
  $p.Add("Strip[$aux].A1=1;"); $p.Add("Strip[$aux].B1=0;"); $p.Add("Strip[$aux].B2=1;")      # music: you hear it, it goes only to B2 (kept out of the VOD by OBS)
  $code = [VMR]::VBVMR_SetParametersW(($p -join "`n"))
  if ($code -ne 0) { throw "Voicemeeter did not accept the settings (code $code)" }
  Start-Sleep -Milliseconds 600
  $res.ok = $true; $res.applied = $p.ToArray()
} catch { $res.error = $_.Exception.Message }
finally { try { [void][VMR]::VBVMR_Logout() } catch { } }
[Console]::Out.WriteLine(($res | ConvertTo-Json -Compress))
