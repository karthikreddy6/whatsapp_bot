param(
  [string]$FastApiPath = "C:\Users\karth\OneDrive\Desktop\onfood\onfoodserver",
  [string]$BotUrl = "http://127.0.0.1:3000"
)

$botRoot = $PSScriptRoot
$botEnv = Join-Path $botRoot '.env'
$fastApiEnv = Join-Path $FastApiPath '.env'

if (-not (Test-Path -LiteralPath $FastApiPath -PathType Container)) {
  throw "FastAPI folder was not found: $FastApiPath"
}

$randomBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
$integrationKey = [Convert]::ToBase64String($randomBytes)

function Set-EnvValue([string]$FilePath, [string]$Name, [string]$Value) {
  $lines = if (Test-Path -LiteralPath $FilePath) { @(Get-Content -LiteralPath $FilePath) } else { @() }
  $pattern = "^\s*" + [regex]::Escape($Name) + "\s*="
  $updated = $false
  $result = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $updated = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $updated) { $result += "$Name=$Value" }
  Set-Content -LiteralPath $FilePath -Value $result -Encoding utf8
}

Set-EnvValue $botEnv 'INTERNAL_API_KEY' $integrationKey
Set-EnvValue $fastApiEnv 'WHATSAPP_BOT_INTERNAL_KEY' $integrationKey
Set-EnvValue $fastApiEnv 'WHATSAPP_BOT_URL' $BotUrl

Write-Output "Configured the private FastAPI-to-WhatsApp integration in $botEnv and $fastApiEnv."
