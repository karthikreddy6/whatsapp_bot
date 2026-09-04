param(
  [Parameter(Mandatory = $true)]
  [string]$Phone,
  [string]$Otp = '123456',
  [int]$ExpiresInMinutes = 5
)

$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing $envPath. Run .\setup-fastapi-integration.ps1 first."
}

$keyLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*INTERNAL_API_KEY\s*=' } | Select-Object -First 1
if (-not $keyLine) {
  throw 'INTERNAL_API_KEY is missing from the local .env file.'
}

$key = ($keyLine -split '=', 2)[1].Trim()
$payload = @{
  phone = $Phone
  otp = $Otp
  expiresInMinutes = $ExpiresInMinutes
} | ConvertTo-Json

$body = [System.Text.Encoding]::UTF8.GetBytes($payload)

Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:3000/internal/whatsapp/send-otp' `
  -Headers @{ 'x-internal-api-key' = $key } `
  -ContentType 'application/json' `
  -Body $body
