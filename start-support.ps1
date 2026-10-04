# Starts the Customer Support Command Center (port 3000)
# Zero Puppeteer / Chromium dependency — rock-solid and ultra lightweight!

$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:WHATSAPP_SERVICE_URL = if ($env:WHATSAPP_SERVICE_URL) { $env:WHATSAPP_SERVICE_URL } else { "http://127.0.0.1:3001" }

Write-Host "Starting OnFood Customer Support Command Center on port $env:PORT..." -ForegroundColor Cyan
node support-server.js
