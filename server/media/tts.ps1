# Text-to-speech with the voices installed in Windows (System.Speech / SAPI). Offline, free.
# Usage: powershell -File tts.ps1 -Action voices
#        powershell -File tts.ps1 -Action speak -TextFile in.txt -Out out.wav [-Voice "Microsoft Zira Desktop"] [-Rate 0] [-Pitch 0]
param([Parameter(Mandatory = $true)][string]$Action, [string]$TextFile = '', [string]$Out = '', [string]$Voice = '', [int]$Rate = 0, [int]$Pitch = 0)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Action -eq 'voices') {
  $list = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { [pscustomobject]@{ name = $_.VoiceInfo.Name; gender = [string]$_.VoiceInfo.Gender; culture = $_.VoiceInfo.Culture.Name } })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $list -Compress))
  $s.Dispose(); exit 0
}
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ($Voice) { try { $s.SelectVoice($Voice) } catch { } }
$s.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
$s.SetOutputToWaveFile($Out)
if ($Pitch -ne 0) {
  $p = switch ([Math]::Max(-2, [Math]::Min(2, $Pitch))) { -2 { 'x-low' } -1 { 'low' } 1 { 'high' } 2 { 'x-high' } default { 'medium' } }
  $esc = [System.Security.SecurityElement]::Escape($text)
  $s.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><prosody pitch='$p'>$esc</prosody></speak>")
} else { $s.Speak($text) }
$s.Dispose()
