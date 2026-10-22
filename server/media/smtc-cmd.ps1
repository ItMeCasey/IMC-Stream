# Sends one control command to the chosen Windows media session.
# Usage: powershell -File smtc-cmd.ps1 -Action play|pause|toggle|next|previous|seek|shuffle|repeat [-Value 12345|true|none|track|list] [-App "AppleMusic"]
param([Parameter(Mandatory = $true)][string]$Action, [string]$Value = '', [string]$App = '')
. (Join-Path $PSScriptRoot 'smtc-common.ps1')
$mgr = Get-Manager
$s = Get-Session $mgr $App
if (-not $s) { [Console]::Out.WriteLine('{"ok":false,"error":"No media player is open"}'); exit 0 }
try {
  $ok = $false
  switch ($Action) {
    'play'     { $ok = Await ($s.TryPlayAsync()) ([bool]) }
    'pause'    { $ok = Await ($s.TryPauseAsync()) ([bool]) }
    'toggle'   { $ok = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
    'next'     { $ok = Await ($s.TrySkipNextAsync()) ([bool]) }
    'previous' { $ok = Await ($s.TrySkipPreviousAsync()) ([bool]) }
    'seek'     { $ok = Await ($s.TryChangePlaybackPositionAsync([int64]([double]$Value * 10000))) ([bool]) }   # ticks = ms * 10000
    'shuffle'  { $ok = Await ($s.TryChangeShuffleActiveAsync([bool]::Parse($Value))) ([bool]) }
    'repeat'   {
      $mode = switch ($Value) { 'track' { 1 } 'list' { 2 } default { 0 } }
      $ok = Await ($s.TryChangeAutoRepeatModeAsync($mode)) ([bool])
    }
    default    { [Console]::Out.WriteLine('{"ok":false,"error":"Unknown action"}'); exit 0 }
  }
  if ($ok) { [Console]::Out.WriteLine('{"ok":true}') } else { [Console]::Out.WriteLine('{"ok":false,"error":"The player did not accept that command"}') }
} catch { [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
