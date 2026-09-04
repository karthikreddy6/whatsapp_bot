# OnFood WhatsApp Support Backend

This server runs the canteen support dashboard, Firebase Realtime Database listeners, WhatsApp order notifications, and basic support bot commands.

## Setup

1. Put your Firebase Admin SDK JSON in this folder as `onfood-adminsdk.json`.
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

For local dashboard preview without Firebase credentials:

```powershell
.\start-dashboard.ps1
```

4. Open:

```text
http://localhost:3000/dashboard.html
```

## Running with Docker

You can run the entire bot and dashboard in Docker with persistent WhatsApp session authentication.

### Using Docker Compose (Recommended)

1. (Optional) Copy `.env.example` to `.env` and configure any environment variables:
   ```bash
   cp .env.example .env
   ```

2. Start the container:
   ```bash
   docker compose up -d
   ```

3. View the QR code or live logs to scan WhatsApp:
   ```bash
   docker compose logs -f whatsapp-bot
   ```

4. Stop the container:
   ```bash
   docker compose down
   ```

> **Note on Session Persistence**: Authentication tokens are mounted to `./.wwebjs_auth` on the host, so you only need to scan the QR code once. Future restarts will automatically log back in.

### Using Docker CLI Directly

Build the image:
```bash
docker build -t onfood-whatsapp-bot .
```

Run the container:
```bash
docker run -d \
  --name onfood-whatsapp-bot \
  -p 3000:3000 \
  --shm-size=1g \
  -v ${PWD}/.wwebjs_auth:/app/.wwebjs_auth \
  onfood-whatsapp-bot
```

## Environment

```text
PORT=3000
FIREBASE_DATABASE_URL=https://onfood-587eb-default-rtdb.firebaseio.com/
FIREBASE_SERVICE_ACCOUNT=./onfood-adminsdk.json
ENABLE_WHATSAPP=true
CANTEEN_WHATSAPP=9876543210
RECENT_WINDOW_MS=7200000
INTERNAL_API_KEY=replace-with-the-same-private-key-used-by-FastAPI
```

Set `ENABLE_WHATSAPP=false` if you want to run only the dashboard without scanning WhatsApp QR.

## FastAPI registration OTP integration

FastAPI calls `POST /internal/whatsapp/send-otp` to deliver account-registration
codes. This endpoint only accepts requests with an `x-internal-api-key` header
matching `INTERNAL_API_KEY`; do not expose it to browsers or Android clients.

Run this once to generate and save the same private key for both local services:

```powershell
.\setup-fastapi-integration.ps1
```

After the bot shows `WhatsApp client is ready.`, test direct OTP delivery:

```powershell
.\test-whatsapp-otp.ps1 -Phone 919666974518
```

For delivery troubleshooting, add this to the bot's `.env` file, restart the
bot, and watch the visible WhatsApp Web window:

```text
WHATSAPP_HEADLESS=false
```

Messages are sent through a sequential queue with a default five-second gap.
Set `WHATSAPP_MESSAGE_DELAY_MS` in `.env` to change the delay; do not set it
to zero for production use.

Replies show a typing indicator and use a short variable typing delay by
default. Set `HUMAN_TYPING_ENABLED=false` to disable that behavior.

## Bot Commands

```text
status ABCD12345678
eta ABCD12345678
help ABCD12345678 missing item
```
