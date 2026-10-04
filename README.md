# OnFood WhatsApp Support & Order Management

Complete redesigned backend and interface for OnFood WhatsApp bot support, customer messaging, and kitchen order management.

## 🌟 Key Features

### 1. Dedicated WhatsApp Messages Interface (`/messages.html`)
- **Clean Message View**: Shows only WhatsApp incoming and outgoing conversations.
- **Contact Threads**: Grouped by phone number and contact name with unread counts and message snippets.
- **Real-Time Stream**: Live Socket.IO feed with delivery status, tags (OTP, Status, Order, Support, Text), and failure indicators.
- **Manual Quick-Send**: Dispatch direct WhatsApp messages with anti-bot rate limits and human delays applied.

### 2. Dedicated Order Status Interface (`/orders.html`)
- **Live Kitchen Progress**: Update status (*Preparing*, *Cooking*, *Ready for Pickup*, *Delivered*).
- **ETA & Buffering**: Set dynamic delivery estimates and preparation buffers.
- **Support Tickets**: Manage customer support tickets raised via WhatsApp flow with one-click reply and resolve.
- **Stuck Order Alerts**: Highlights orders stuck in a state for >15 minutes.

### 3. Anti-Detection & Human Behavior System
- **Random Delays**: Unpredictable bell-curve delays (default 2s – 8s) between sends.
- **Rate Limiting**: Per-recipient caps (default 3 msgs/min) and global system cap (default 20 msgs/min).
- **User Interaction Emulation**:
  - Blue ticks / seen markers before sending replies.
  - Realistic typing indicators based on message length and typing speed (CPM).
  - Variable human reading/thinking delay (1.5s – 5s) before auto-replying.
- **Device Fingerprint Consistency**: Stable session persistence in `.wwebjs_auth/session-onfood-support`.
- **Aggressive Error Backoff**: Exponential cooldown with jitter on network or rate limit errors.
- **Message Variety**: Randomized greetings, multiple phrasing templates for order updates, and dynamic sign-offs.

### 4. Live Customization (UI & Firebase)
- Click **⚙️ Customize** on either page to adjust delays, rates, typing speeds, backoff parameters, or preparation buffer in real time.
- Settings are persisted to Firebase Realtime Database and synced live to all clients.

---

## 🚀 Quick Start (Separated Services)

The system is split into two independent services so WhatsApp/Puppeteer bugs never crash the Customer Support Command Center:

### Option A: Run Both Together (Supervisor with Auto-Restart)
Spawns Customer Support on port 3000 and runs WhatsApp on port 3001 in an isolated child process. If WhatsApp crashes, the supervisor restarts it while the support desk stays 100% active.
```bash
npm start
# or using PowerShell:
.\start-all.ps1
```

### Option B: Run Customer Support Only (Port 3000)
Pure Node.js + Express + Socket.IO + PostgreSQL. Zero Puppeteer/Chromium memory footprint, instant startup:
```bash
npm run start:support
# or using PowerShell:
.\start-support.ps1
```

### Option C: Run WhatsApp Microservice Only (Port 3001)
Dedicated WhatsApp Web engine with QR scanning, rate limiting, and bot auto-replies:
```bash
npm run start:whatsapp
# or using PowerShell:
.\start-whatsapp.ps1
```

### 3. Open Support Desk in Browser
- **Unified Customer Support Desk (Primary)**: [http://localhost:3000/index.html](http://localhost:3000/index.html) (or root `/`)
- **Messages (Dedicated)**: [http://localhost:3000/messages.html](http://localhost:3000/messages.html)
- **Order Status (Dedicated)**: [http://localhost:3000/orders.html](http://localhost:3000/orders.html)

---

## 🐳 Docker Deployment

The `docker-compose.yml` configures two isolated containers:
1. `customer-support`: Node.js Express & PostgreSQL sync on port 3000.
2. `whatsapp-bot`: Chromium & WhatsApp Web client on port 3001.

```bash
docker compose up -d
docker compose logs -f whatsapp-bot
```

QR code will display in logs on first launch. Subsequent boots use the cached session in `./.wwebjs_auth`.

---

## ⚙️ Configuration Endpoints

- `GET /api/summary`: Returns live metrics, orders, tickets, and status.
- `GET /api/messages`: Returns message history (optional `?phone=` filter).
- `POST /api/messages/send`: Send manual message `{ "phone": "...", "message": "..." }`.
- `GET /api/settings`: Returns current rate-limiting and behavior settings.
- `POST /api/settings`: Update settings in real time.
- `POST /api/settings/reset`: Reset all settings to defaults.

---

## 🧪 30-Minute Full System & Stress Test Runner

A complete automated test suite is provided to verify all bot functions, anti-detection rate limits, burst handling, and long-running stability over a 30-minute session.

### What It Tests:
1. **Send OTP to new numbers every 5 seconds** (continuous unique Indian mobile numbers).
2. **Multi-OTP bursts** (4 concurrent OTP blasts every 30s to stress rate-limiting and queue jitter).
3. **Direct WhatsApp outbound message** (`/api/messages/send`).
4. **Order Status lifecycle** (`Pending` → `Preparing` → `Cooking` → `Ready` → `Delivered`).
5. **Order ETA adjustments** (`/api/orders/:orderId/eta`).
6. **Support Ticket reply & resolution** (`/api/tickets/:id/reply`, `/resolve`).
7. **Kitchen preparation buffer changes** (`/api/buffering-time`).
8. **Bot customization live update & sync** (`/api/settings`).
9. **Metric & message audit** (`/api/summary`, `/api/messages`).

### How to Run:

Using PowerShell:
```powershell
# Runs full 30 minutes
.\run-30min-test.ps1

# Custom duration (e.g. 5 minutes)
.\run-30min-test.ps1 -DurationMinutes 5
```

Using Node directly:
```bash
# Default 30 minutes
node test-all-functions.js

# Custom duration (e.g. 10 minutes)
node test-all-functions.js --duration 10

# Custom intervals
node test-all-functions.js --duration 30 --interval 5000 --burst-interval 30
```

> **Note**: If the server is not already running, the test runner will automatically detect and start a local instance, and cleanly shut it down when the test finishes. Live progress and a countdown timer are rendered in the console, and detailed execution logs are stored in `test-30min-results.log`.
