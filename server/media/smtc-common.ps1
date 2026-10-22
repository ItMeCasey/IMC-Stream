# Shared helpers: talk to Windows' System Media Transport Controls (what Apple Music, Spotify, browsers... publish to).
# Needs Windows PowerShell 5.1 (powershell.exe). Dot-sourced by smtc-poll.ps1 and smtc-cmd.ps1.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

function Get-Manager {
  Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
}

# Pick the session to follow: 'auto' = the first music-player-looking one, a name = the one whose app id contains it, blank = Windows' current session.
function Get-Session($mgr, [string]$app) {
  if ($app -eq 'auto') {   # first session that looks like a music player (ignores browser videos, games, ...)
    foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -match '(?i)apple|itunes|spotify|music|tidal|deezer|amazon|foobar|vlc|winamp|musicbee|aimp|zune|groove') { return $s } }
    return $null
  }
  if ($app) {
    foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -like "*$app*") { return $s } }
    return $null
  }
  return $mgr.GetCurrentSession()
}

function Get-Thumb($props) {
  try {
    if (-not $props.Thumbnail) { return '' }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [uint32]$stream.Size
    if ($size -eq 0 -or $size -gt 8000000) { return '' }
    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
    $null = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    $reader.Dispose(); $stream.Dispose()
    return $stream.ContentType + ';' + [Convert]::ToBase64String($bytes)
  } catch { return '' }
}
