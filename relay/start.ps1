# Starts VoltEPIC's report server and its ngrok tunnel; Ctrl+C stops both.
#   powershell -ExecutionPolicy Bypass -File relay\start.ps1
$Domain = "camper-envision-quill.ngrok-free.dev"   # the ngrok account's fixed dev domain; SERVER in assets/js/llm/relay.js is https://$Domain
$Port = 8788
$Ngrok = "$env:LOCALAPPDATA\ngrok\ngrok.exe"

if (-not $Domain) { Write-Error "Set `$Domain in relay\start.ps1 first."; exit 1 }
$server = Start-Process node -ArgumentList "`"$PSScriptRoot\server.mjs`"" -NoNewWindow -PassThru
try { & $Ngrok http --url=$Domain $Port } finally { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
