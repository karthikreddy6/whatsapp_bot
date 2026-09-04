$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:ENABLE_MOCK_DB = if ($env:ENABLE_MOCK_DB) { $env:ENABLE_MOCK_DB } else { "true" }
$env:ENABLE_WHATSAPP = if ($env:ENABLE_WHATSAPP) { $env:ENABLE_WHATSAPP } else { "false" }

node index.js
