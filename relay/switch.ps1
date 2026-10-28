# VoltEPIC's on/off switch: if the report server runs, stops it (it stops collecting requests; within ~20 s the mailbox
# tells the site the server is offline); otherwise starts it in the background and waits until the mailbox sees it.
# The server only connects out (to the mailbox and the lab); nothing connects to this PC. Works only on this PC; nothing
# starts at logon.
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File relay\switch.ps1
#   powershell -ExecutionPolicy Bypass -File relay\switch.ps1 -Shortcut     (puts the switch on the desktop)
param([switch]$Shortcut)
$say = { param($text, $icon) [void](New-Object -ComObject WScript.Shell).Popup($text, 0, "VoltEPIC report server", $icon) }
$ours = { @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*relay*server.mjs*" }) }
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
  & $say "KAPALI`n`nRapor sunucusu durdu; site birkaç saniye içinde 'offline' gösterir.`nAçmak için kısayola yeniden tıkla." 64
  exit
}

# server.log: one line per report (time, request, status, seconds); it stays on the PC, outside the Drive-synced folder.
$Logs = New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\voltepic"
$Mailbox = ((Get-Content "$PSScriptRoot\.env" -ErrorAction SilentlyContinue) -match '^MAILBOX_URL=' | Select-Object -First 1) -replace '^MAILBOX_URL=', ''
Start-Process cmd.exe -ArgumentList "/c node `"$PSScriptRoot\server.mjs`" >> `"$Logs\server.log`" 2>&1" -WindowStyle Hidden
foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 500
  $on = try { (Invoke-RestMethod "$Mailbox/status" -TimeoutSec 3).pc } catch { $false }
  if ($on) { & $say "AÇIK`n`nSite rapor yazabiliyor.`nKapatmak için kısayola yeniden tıkla." 64; exit }
}
& $stop
& $say "AÇILAMADI, sunucu kapatıldı.`n`nSebep için: $Logs\server.log" 48
