# Long-running helper: reads one JSON command per line on stdin, answers with one JSON line on stdout. Talks to a RUNNING Voicemeeter through its Remote API.
#   {"op":"get"}                                 -> {"ok":true,"kind":"banana","local":-6.0,"b1":0.0,"b2":-3.0}   (bus gains in dB)
#   {"op":"set","which":"local|b1|b2|mic|game|music","db":-6}   (mic/game/music = the input strips: microphone, Windows sound (VAIO), Aux)   -> {"ok":true,...same as get}
# local = bus A1 (what you hear), b1 / b2 = buses B1 / B2 (what OBS records: game + mic, and music).
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
$dir = Join-Path ${env:ProgramFiles(x86)} 'VB\Voicemeeter'
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
if (-not (Test-Path (Join-Path $dir 'VoicemeeterRemote64.dll'))) { Say @{ ok = $false; error = 'Voicemeeter is not installed' }; exit 0 }
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VMK { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetDllDirectory(string p); }
public static class VMR {
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_Login();
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_Logout();
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_GetVoicemeeterType(out int t);
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall)] public static extern int VBVMR_IsParametersDirty();
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)] public static extern int VBVMR_GetParameterFloat(string n, out float v);
  [DllImport("VoicemeeterRemote64.dll", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)] public static extern int VBVMR_SetParameterFloat(string n, float v);
}
"@
[void][VMK]::SetDllDirectory($dir)
$in = $false
function Connect { if ($script:in) { return $true } ; $r = [VMR]::VBVMR_Login(); if ($r -eq 0) { $script:in = $true; Start-Sleep -Milliseconds 1200; return $true } ; return $false }
function Buses {   # bus index of A1, B1, B2 for each Voicemeeter type (1 standard, 2 banana, 3 potato)
  $t = 0; if ([VMR]::VBVMR_GetVoicemeeterType([ref]$t) -ne 0) { return $null }
  switch ($t) { 1 { return @{ kind = 'standard'; a1 = 0; b1 = 1; b2 = -1; mic = 0; game = 2; music = -1 } } 2 { return @{ kind = 'banana'; a1 = 0; b1 = 3; b2 = 4; mic = 0; game = 3; music = 4 } } 3 { return @{ kind = 'potato'; a1 = 0; b1 = 5; b2 = 6; mic = 0; game = 5; music = 6 } } default { return $null } }
}
function GetG($i, $kind = 'Bus', $layer = '') { if ($i -lt 0) { return $null } ; $v = [single]0; $name = if ($layer) { "$kind[$i]" } else { "$kind[$i].Gain" }; if ([VMR]::VBVMR_GetParameterFloat($name, [ref]$v) -ne 0) { return $null } ; return [math]::Round($v, 1) }
function Layers($b, $strip) { if ($strip -lt 0) { return $null } ; @{ a1 = (GetG $b.a1 "Strip[$strip].GainLayer" 'x'); b1 = (GetG $b.b1 "Strip[$strip].GainLayer" 'x'); b2 = (GetG $b.b2 "Strip[$strip].GainLayer" 'x') } }
function State($b) { 1..4 | ForEach-Object { [void][VMR]::VBVMR_IsParametersDirty(); Start-Sleep -Milliseconds 60 }; @{ ok = $true; kind = $b.kind; local = (GetG $b.a1); b1 = (GetG $b.b1); b2 = (GetG $b.b2); mic = (GetG $b.mic 'Strip'); game = (GetG $b.game 'Strip'); music = (GetG $b.music 'Strip'); layers = @{ game = (Layers $b $b.game); music = (Layers $b $b.music); mic = (Layers $b $b.mic) } } }
while ($true) {
  $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }
  try {
    $cmd = $line | ConvertFrom-Json
    if (-not (Connect)) { Say @{ ok = $false; error = 'Voicemeeter is not running' }; continue }
    $b = Buses; if (-not $b) { Say @{ ok = $false; error = 'Voicemeeter is not ready yet' }; continue }
    if ($cmd.op -eq 'set') {
      $kind = 'Bus'; $i = switch ($cmd.which) { 'local' { $b.a1 } 'b1' { $b.b1 } 'b2' { $b.b2 } 'mic' { $kind = 'Strip'; $b.mic } 'game' { $kind = 'Strip'; $b.game } 'music' { $kind = 'Strip'; $b.music } default { -1 } }
      if ($i -lt 0) { Say @{ ok = $false; error = 'That input does not exist in this Voicemeeter version' }; continue }
      if ($cmd.layer) {   # one input strip's gain on ONE bus: {"op":"set","which":"game|music|mic","layer":"a1|b1|b2","db":-6}
        $si = switch ($cmd.which) { 'mic' { $b.mic } 'game' { $b.game } 'music' { $b.music } default { -1 } }; $bi = switch ($cmd.layer) { 'a1' { $b.a1 } 'b1' { $b.b1 } 'b2' { $b.b2 } default { -1 } }
        if ($si -lt 0 -or $bi -lt 0) { Say @{ ok = $false; error = 'That input or bus does not exist' }; continue }
        [void][VMR]::VBVMR_SetParameterFloat("Strip[$si].GainLayer[$bi]", [single]([math]::Max(-60, [math]::Min(12, [double]$cmd.db)))); Say @{ ok = $true }; continue
      }
      $db = [math]::Max(-60, [math]::Min(12, [double]$cmd.db)); [void][VMR]::VBVMR_SetParameterFloat("$kind[$i].Gain", [single]$db)
      Say @{ ok = $true }; continue   # answer at once: the caller moves OBS's volume at the same moment, so any delay here would let the stream hear the two out of step
    }
    Say (State $b)
  } catch { $script:in = $false; Say @{ ok = $false; error = $_.Exception.Message } }
}
if ($in) { try { [void][VMR]::VBVMR_Logout() } catch { } }
