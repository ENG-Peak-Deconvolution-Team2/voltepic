# VoltEPIC's on/off switch: if the report server or its ngrok tunnel runs, stops both (no door from the internet, the
# site says the server is offline); otherwise starts both in the background. Works only on this PC; nothing starts at logon.
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File relay\switch.ps1
#   powershell -ExecutionPolicy Bypass -File relay\switch.ps1 -Shortcut     (puts the switch on the desktop)
param([switch]$Shortcut)
$Domain = "camper-envision-quill.ngrok-free.dev"   # the ngrok account's fixed dev domain; SERVER in assets/js/llm/relay.js is https://$Domain
$Port = 8788
$Ngrok = "$env:LOCALAPPDATA\ngrok\ngrok.exe"
$say = { param($text, $icon) [void](New-Object -ComObject WScript.Shell).Popup($text, 0, "VoltEPIC report server", $icon) }
$ours = { @(Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "node.exe" -and $_.CommandLine -like "*relay*server.mjs*") -or ($_.Name -eq "ngrok.exe" -and $_.CommandLine -like "*http*$Port*") }) }
$stop = { & $ours | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }

if ($Shortcut) {
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "VoltEPIC aç-kapa.lnk"))
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,27"
  $lnk.Description = "VoltEPIC report server: aç / kapat"
  $lnk.Save(); Write-Output "Shortcut: $($lnk.FullName)"; exit
}

if ((& $ours).Count) {
  & $stop
  & $say "KAPALI`n`nTünel kapandı; site 'offline' gösteriyor.`nAçmak için kısayola yeniden tıkla." 64
  exit
}

# server.log: one line per request (time, IP, status, seconds); ngrok.log: the tunnel's own log. Both stay on the PC,
# outside the Drive-synced project folder, since they hold visitors' IP addresses.
$Logs = New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\voltepic"
Start-Process cmd.exe -ArgumentList "/c node `"$PSScriptRoot\server.mjs`" >> `"$Logs\server.log`" 2>&1" -WindowStyle Hidden
Start-Process $Ngrok -ArgumentList "http --url=$Domain 127.0.0.1:$Port --log `"$Logs\ngrok.log`"" -WindowStyle Hidden
foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 500
  $tunnel = try { (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 2).tunnels.public_url -contains "https://$Domain" } catch { $false }
  $server = try { (New-Object Net.Sockets.TcpClient).Connect("127.0.0.1", $Port); $true } catch { $false }
  if ($tunnel -and $server) { & $say "AÇIK`n`nSite rapor yazabiliyor: https://$Domain`nKapatmak için kısayola yeniden tıkla." 64; exit }
}
& $stop
& $say "AÇILAMADI, ikisi de kapatıldı.`n`nSebep için: $Logs\server.log ve ngrok.log" 48
