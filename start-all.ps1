# Starts both Customer Support (port 3000) and isolated WhatsApp microservice (port 3001)
# With isolated crash protection & auto-restart

$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:WHATSAPP_PORT = if ($env:WHATSAPP_PORT) { $env:WHATSAPP_PORT } else { "3001" }
$env:ENABLE_WHATSAPP = "true"

Write-Host "Starting OnFood Supervisor (Customer Support Desk + WhatsApp Microservice)..." -ForegroundColor Yellow
node index.js
