# Starts the standalone WhatsApp Microservice (port 3001)
# Manages WhatsApp Web session, QR code, rate limiting, and Puppeteer client

$env:WHATSAPP_PORT = if ($env:WHATSAPP_PORT) { $env:WHATSAPP_PORT } else { "3001" }
$env:SUPPORT_SERVICE_URL = if ($env:SUPPORT_SERVICE_URL) { $env:SUPPORT_SERVICE_URL } else { "http://127.0.0.1:3000" }

Write-Host "Starting OnFood WhatsApp Microservice on port $env:WHATSAPP_PORT..." -ForegroundColor Green
node whatsapp-service.js
