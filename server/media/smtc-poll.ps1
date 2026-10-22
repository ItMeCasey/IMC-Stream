# Prints one JSON line per second describing what the chosen Windows media session is playing.
# Usage: powershell -File smtc-poll.ps1 [-App "AppleMusic"] [-Once]
param([string]$App = '', [int]$ParentPid = 0, [switch]$Once)
. (Join-Path $PSScriptRoot 'smtc-common.ps1')
$mgr = Get-Manager
$lastKey = ''; $lastThumb = ''; $thumbTries = 0
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }   # stop when the server is gone
  $o = [ordered]@{ status = 'none'; sessions = @() }
  try {
    $o.sessions = @($mgr.GetSessions() | ForEach-Object { $_.SourceAppUserModelId })
    $s = Get-Session $mgr $App
    if ($s) {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties(); $pb = $s.GetPlaybackInfo()
      $key = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      $thumbChanged = $false
      if ($key -ne $lastKey) { $lastKey = $key; $lastThumb = Get-Thumb $props; $thumbTries = 1; $thumbChanged = $true }
      elseif (-not $lastThumb -and $thumbTries -lt 12) {   # some players publish the cover a moment after the title: keep trying
        $thumbTries++; $t = Get-Thumb $props; if ($t) { $lastThumb = $t; $thumbChanged = $true }
      }
      $o.status = ([string]$pb.PlaybackStatus).ToLower()
      $o.app = $s.SourceAppUserModelId
      $o.title = $props.Title; $o.artist = $props.Artist; $o.album = $props.AlbumTitle
      $o.durationMs = [int64]($tl.EndTime - $tl.StartTime).TotalMilliseconds
      $pos = ($tl.Position - $tl.StartTime).TotalMilliseconds
      if ($o.status -eq 'playing') { $pos += ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds }
      $o.positionMs = [int64][Math]::Max(0, [Math]::Min($pos, $o.durationMs))
      $o.shuffle = [bool]$pb.IsShuffleActive
      $o.repeat = if ($pb.AutoRepeatMode -ne $null) { ([string]$pb.AutoRepeatMode).ToLower() } else { 'none' }
      $o.canSeek = [bool]$pb.Controls.IsPlaybackPositionEnabled
      if ($thumbChanged) { $o.art = $lastThumb }
    }
  } catch { $o.error = $_.Exception.Message }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush()
  if ($Once) { break }
  Start-Sleep -Milliseconds 1000
}
