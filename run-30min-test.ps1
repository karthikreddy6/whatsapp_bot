param(
  [double]$DurationMinutes = 30,
  [int]$Port = 3000,
  [int]$OtpIntervalMs = 5000,
  [int]$BurstIntervalSec = 30
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Starting OnFood WhatsApp Bot 30-Minute Full Stress Test" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Duration:       $DurationMinutes minute(s)"
Write-Host "Port:           $Port"
Write-Host "OTP Interval:   $OtpIntervalMs ms (continuous to new numbers)"
Write-Host "Burst Interval: $BurstIntervalSec seconds (multi-OTP bursts)"
Write-Host ""
Write-Host "Functions tested: Send OTP (every 5s), Multi-OTP bursts, Direct WhatsApp sends,"
Write-Host "Order status lifecycle, Order ETA, Ticket replies/resolve, Buffer setting,"
Write-Host "Bot customizer live sync, and Summary metrics audit."
Write-Host ""
Write-Host "Press Ctrl+C at any time to halt and print the summary report." -ForegroundColor Yellow
Write-Host ""

node test-all-functions.js --duration $DurationMinutes --port $Port --interval $OtpIntervalMs --burst-interval $BurstIntervalSec
