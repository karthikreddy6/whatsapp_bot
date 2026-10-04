const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const express = require('express');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const {
  loadLocalEnvironment,
  DEFAULT_SETTINGS,
  deepClone,
  mergeSettings,
  normalizePhone,
  formatTime,
  extractOrderId
} = require('./shared');

// ═══════════════════════════════════════════════════════════════════
//  Environment & Configuration
// ═══════════════════════════════════════════════════════════════════

loadLocalEnvironment();

const WHATSAPP_PORT = Number(process.env.WHATSAPP_PORT || 3001);
const SUPPORT_SERVICE_URL = process.env.SUPPORT_SERVICE_URL || 'http://127.0.0.1:3000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const ADMIN_PHONE = '9100064518';
const CANTEEN_WHATSAPP = normalizePhone(process.env.CANTEEN_WHATSAPP || '');
const isRunningInDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);
const WHATSAPP_HEADLESS = isRunningInDocker || process.env.WHATSAPP_HEADLESS !== 'false';

// ═══════════════════════════════════════════════════════════════════
//  Persistent File Logging
// ═══════════════════════════════════════════════════════════════════

let logFile = path.join(__dirname, 'bot.log');
try {
  if (fs.existsSync(logFile) && fs.statSync(logFile).isDirectory()) {
    logFile = path.join(logFile, 'bot.log');
  }
} catch (e) {}

let logStream = null;
try {
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.on('error', () => {});
} catch (e) {}

for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    if (logStream && !logStream.destroyed) {
      const line = args.map(value => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      }).join(' ');
      try {
        logStream.write(`[${new Date().toISOString()}] [${level}] ${line}\n`);
      } catch (writeErr) {}
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Rate Limiter & Backoff Tracker
// ═══════════════════════════════════════════════════════════════════

let botSettings = deepClone(DEFAULT_SETTINGS);

class RateLimiter {
  constructor() {
    this.perRecipient = new Map();
    this.globalHistory = [];
  }

  canSend(phone) {
    this._cleanup();
    const limit = botSettings.rateLimits;
    const recipientHistory = this.perRecipient.get(phone) || [];
    if (recipientHistory.length >= limit.perRecipientPerMinute) return false;
    if (this.globalHistory.length >= limit.globalPerMinute) return false;
    return true;
  }

  record(phone) {
    const now = Date.now();
    if (!this.perRecipient.has(phone)) this.perRecipient.set(phone, []);
    this.perRecipient.get(phone).push(now);
    this.globalHistory.push(now);
  }

  waitTime(phone) {
    this._cleanup();
    const limit = botSettings.rateLimits;
    const recipientHistory = this.perRecipient.get(phone) || [];
    const oldest = recipientHistory.length >= limit.perRecipientPerMinute
      ? recipientHistory[0] : null;
    const globalOldest = this.globalHistory.length >= limit.globalPerMinute
      ? this.globalHistory[0] : null;
    const waits = [];
    if (oldest) waits.push(oldest + 60000 - Date.now());
    if (globalOldest) waits.push(globalOldest + 60000 - Date.now());
    return waits.length ? Math.max(0, Math.max(...waits)) : 0;
  }

  _cleanup() {
    const cutoff = Date.now() - 60000;
    for (const [phone, timestamps] of this.perRecipient) {
      const filtered = timestamps.filter(t => t > cutoff);
      if (filtered.length) this.perRecipient.set(phone, filtered);
      else this.perRecipient.delete(phone);
    }
    this.globalHistory = this.globalHistory.filter(t => t > cutoff);
  }
}

class BackoffTracker {
  constructor() {
    this.consecutiveErrors = 0;
    this.lastErrorAt = 0;
  }

  recordError() {
    this.consecutiveErrors++;
    this.lastErrorAt = Date.now();
  }

  recordSuccess() {
    this.consecutiveErrors = 0;
  }

  getDelay() {
    if (this.consecutiveErrors === 0) return 0;
    const config = botSettings.errorHandling;
    const delay = Math.min(
      config.backoffBaseMs * Math.pow(config.backoffMultiplier, this.consecutiveErrors - 1),
      config.backoffMaxMs
    );
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(delay + jitter));
  }

  isInBackoff() {
    if (this.consecutiveErrors === 0) return false;
    const elapsed = Date.now() - this.lastErrorAt;
    return elapsed < this.getDelay();
  }
}

const rateLimiter = new RateLimiter();
const backoffTracker = new BackoffTracker();

function humanSendDelay() {
  const { minDelayMs, maxDelayMs } = botSettings.rateLimits;
  const r = (Math.random() + Math.random() + Math.random()) / 3;
  return minDelayMs + Math.floor(r * (maxDelayMs - minDelayMs));
}

function typingDuration(messageLength) {
  if (!botSettings.humanBehavior.typingEnabled) return 0;
  const cpm = botSettings.humanBehavior.typingSpeedCPM;
  const baseMs = (messageLength / cpm) * 60000;
  const jitter = Math.floor(Math.random() * 1200) - 400;
  return Math.min(Math.max(Math.floor(baseMs + jitter), 700), 6000);
}

function replyDelay() {
  const { responseDelayMinMs, responseDelayMaxMs } = botSettings.humanBehavior;
  const r = (Math.random() + Math.random()) / 2;
  return Math.floor(responseDelayMinMs + r * (responseDelayMaxMs - responseDelayMinMs));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════
//  Message Variations & FAQs
// ═══════════════════════════════════════════════════════════════════

const GREETING_VARIATIONS = [
  '👋 *Hello!* Welcome to OnFood Support.\n\nYou can ask about:\n- *status ORDERID* (check order)\n- *eta ORDERID* (check time)\n- *menu* (today\'s special)\n- *hours* (opening time)\n- *help* (report a problem)',
  '👋 *Hi there!* OnFood Support here.\n\nHere\'s what I can help with:\n- *status ORDERID* — check your order\n- *eta ORDERID* — estimated time\n- *menu* — see today\'s specials\n- *hours* — canteen hours\n- *help* — report an issue',
  '👋 *Hey!* Welcome to OnFood.\n\nTry any of these:\n- *status ORDERID* to check order status\n- *eta ORDERID* for estimated time\n- *menu* for today\'s food\n- *hours* for opening times\n- *help* to report a problem',
];

const FAQ_HOURS_VARIATIONS = [
  '⏰ *Canteen Hours:*\nMon-Fri: 8:30 AM - 6:00 PM\nSat: 9:00 AM - 4:00 PM\nSun: Closed',
  '⏰ *Opening Times:*\nWeekdays: 8:30 AM – 6:00 PM\nSaturday: 9:00 AM – 4:00 PM\nSunday: Closed',
];

const FAQ_MENU_VARIATIONS = [
  '🍛 *Today\'s Special:*\nPlease check the OnFood app for the latest menu and special offers! We have fresh Masala Dosa and Veg Fried Rice today.',
  '🍛 *Menu Update:*\nCheck the OnFood app for today\'s full menu! Specials include Masala Dosa and Veg Fried Rice.',
];

const FAQ_LOCATION_VARIATIONS = [
  '📍 *Find Us:*\nWe are located at the Main Campus Canteen, Ground Floor.',
  '📍 *Location:*\nMain Campus Canteen, Ground Floor. See you there!',
];

const HELP_MENU = [
  '*OnFood Problem Report*',
  'What is the issue? Reply with the number:',
  '1️⃣ Order is late',
  '2️⃣ Missing item',
  '3️⃣ Food quality issue',
  '4️⃣ Other / Chat with staff'
].join('\n');

const HELP_CATEGORIES = {
  '1': 'Order is late',
  '2': 'Missing item',
  '3': 'Food quality issue',
  '4': 'General Inquiry'
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ═══════════════════════════════════════════════════════════════════
//  WhatsApp Client State & Queue
// ═══════════════════════════════════════════════════════════════════

let whatsappClient = null;
let whatsappReady = false;
let whatsappStatus = 'initializing'; // 'initializing' | 'qr_required' | 'ready' | 'disconnected'
let whatsappRestartTimer = null;
let whatsappSendQueue = Promise.resolve();
let lastWhatsAppSentAt = 0;
const userSessions = new Map();

// ═══════════════════════════════════════════════════════════════════
//  WhatsApp Web Crash Protections & Patches
// ═══════════════════════════════════════════════════════════════════

function clearChromiumLocks() {
  const sessionDir = path.join(__dirname, '.wwebjs_auth', 'session-onfood-support');
  if (fs.existsSync(sessionDir)) {
    for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = path.join(sessionDir, file);
      try {
        if (fs.existsSync(lockPath) || fs.lstatSync(lockPath)) {
          fs.unlinkSync(lockPath);
          console.log(`[WhatsAppService] Cleaned up stale Chromium lock: ${file}`);
        }
      } catch (e) {}
    }
  }
}

async function installSendMessagePatch(pupPage) {
  if (!pupPage) return;
  try {
    await pupPage.evaluate(() => {
      try {
        const storeModule = window.require && window.require('WAWebStatusRankingGatingUtils');
        if (storeModule && typeof storeModule.canCheckStatusRankingPosterGation !== 'function') {
          storeModule.canCheckStatusRankingPosterGation = () => false;
        }
      } catch (e) {
        try {
          const origRequire = window.require;
          if (origRequire && !origRequire._patched) {
            window.require = function(moduleName) {
              const mod = origRequire(moduleName);
              if (mod && typeof mod === 'object' && !mod.canCheckStatusRankingPosterGation) {
                mod.canCheckStatusRankingPosterGation = () => false;
              }
              return mod;
            };
            Object.keys(origRequire).forEach(k => { window.require[k] = origRequire[k]; });
            window.require._patched = true;
          }
        } catch (e2) {}
      }
    });

    await pupPage.evaluate(() => {
      if (window.WWebJS && !window.WWebJS._sendMessagePatched) {
        const origSend = window.WWebJS.sendMessage;
        window.WWebJS.sendMessage = async function(chat, content, options) {
          try {
            const res = await origSend.call(this, chat, content, options);
            if (res) return res;
          } catch (err) {
            if (!String(err).includes('canCheckStatusRankingPosterGat')) {
              throw err;
            }
          }
          if (chat && chat.msgs && chat.msgs.length) {
            const last = chat.msgs.last();
            if (last) return last;
          }
          return null;
        };
        window.WWebJS._sendMessagePatched = true;
      }
    });
  } catch (e) {}
}

async function notifySupportServiceStatus(statusObj) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`${SUPPORT_SERVICE_URL}/api/internal/whatsapp/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(statusObj),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch (e) {}
}

function setupWhatsApp() {
  clearChromiumLocks();

  whatsappStatus = 'initializing';
  notifySupportServiceStatus({ ready: false, status: 'initializing' });

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ clientId: "onfood-support" }),
    puppeteer: {
      headless: WHATSAPP_HEADLESS,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      protocolTimeout: 0
    }
  });

  whatsappClient.on('qr', qr => {
    whatsappStatus = 'qr_required';
    notifySupportServiceStatus({ ready: false, status: 'qr_required' });
    console.log('\n[WhatsAppService] 📱 Scan this QR code to log into WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  whatsappClient.on('ready', async () => {
    whatsappReady = true;
    whatsappStatus = 'ready';
    const version = await whatsappClient.getWWebVersion().catch(() => 'unknown');
    console.log(`[WhatsAppService] WhatsApp client is READY! Version: ${version}`);
    await installSendMessagePatch(whatsappClient.pupPage);
    backoffTracker.recordSuccess();

    notifySupportServiceStatus({
      ready: true,
      status: 'ready',
      info: whatsappClient.info ? whatsappClient.info.wid : null
    });
  });

  whatsappClient.on('message', handleIncomingWhatsAppMessage);
  whatsappClient.on('error', error => console.error('[WhatsAppService] WhatsApp error:', error.message || error));
  whatsappClient.on('auth_failure', reason => scheduleWhatsAppRestart(`authentication failed: ${reason}`));
  whatsappClient.on('disconnected', reason => scheduleWhatsAppRestart(`disconnected: ${reason}`));

  whatsappClient.initialize().catch(error => scheduleWhatsAppRestart(error.message || error));
}

function scheduleWhatsAppRestart(reason) {
  whatsappReady = false;
  whatsappStatus = 'disconnected';
  notifySupportServiceStatus({ ready: false, status: 'disconnected' });
  console.error(`[WhatsAppService] WhatsApp needs restart: ${reason}`);

  if (whatsappRestartTimer) return;

  backoffTracker.recordError();
  const restartDelay = Math.max(5000, backoffTracker.getDelay());
  console.log(`[WhatsAppService] Scheduling restart in ${Math.round(restartDelay / 1000)}s (attempt ${backoffTracker.consecutiveErrors})`);

  const failedClient = whatsappClient;
  whatsappRestartTimer = setTimeout(() => {
    whatsappRestartTimer = null;
    setupWhatsApp();
  }, restartDelay);

  if (failedClient) {
    Promise.resolve(failedClient.destroy()).catch(() => {});
  }
}

process.on('unhandledRejection', reason => {
  const message = String(reason && (reason.message || reason));
  if (message.includes('Execution context was destroyed') || message.includes('Target closed')) {
    scheduleWhatsAppRestart(message);
    return;
  }
  if (message.includes('canCheckStatusRankingPosterGat')) {
    return;
  }
  console.error('[WhatsAppService] Unhandled promise rejection:', reason);
});

// ═══════════════════════════════════════════════════════════════════
//  WhatsApp Sending Pipeline (Rate-limited + Human Delays)
// ═══════════════════════════════════════════════════════════════════

function sendWhatsApp(phone, message, type = 'text') {
  const queuedSend = whatsappSendQueue.then(async () => {
    const normalizedPhone = normalizePhone(phone);

    if (backoffTracker.isInBackoff()) {
      const backoffDelay = backoffTracker.getDelay();
      console.log(`[WhatsAppService] Backoff active: waiting ${Math.round(backoffDelay / 1000)}s`);
      await sleep(backoffDelay);
    }

    if (!rateLimiter.canSend(normalizedPhone)) {
      const waitMs = rateLimiter.waitTime(normalizedPhone);
      console.log(`[WhatsAppService] Rate limited for ${normalizedPhone}: waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs + 500);
    }

    const delayMs = humanSendDelay();
    const elapsed = Date.now() - lastWhatsAppSentAt;
    const remaining = Math.max(0, delayMs - elapsed);
    if (remaining > 0) {
      await sleep(remaining);
    }

    const sent = await sendWhatsAppNow(normalizedPhone, message, type);
    if (sent) {
      lastWhatsAppSentAt = Date.now();
      rateLimiter.record(normalizedPhone);
      backoffTracker.recordSuccess();
    } else {
      backoffTracker.recordError();
    }
    return sent;
  });
  whatsappSendQueue = queuedSend.catch(() => false);
  return queuedSend;
}

async function sendWhatsAppNow(phone, message, type) {
  if (!whatsappClient || !whatsappReady) return false;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return false;

  try {
    const numberId = await whatsappClient.getNumberId(normalizedPhone);
    if (!numberId) {
      console.error(`[WhatsAppService] Number is not registered on WhatsApp: ${normalizedPhone}`);
      return false;
    }
    const chatId = numberId._serialized;
    const pnChatId = `${normalizedPhone}@c.us`;

    await installSendMessagePatch(whatsappClient.pupPage);

    // Read receipt simulation
    if (botSettings.humanBehavior.readReceiptsEnabled) {
      try {
        const chat = (await whatsappClient.getChatById(pnChatId).catch(() => null)) ||
                     (await whatsappClient.getChatById(chatId).catch(() => null));
        if (chat && chat.unreadCount > 0 && typeof chat.sendSeen === 'function') {
          await chat.sendSeen();
          await sleep(500 + Math.floor(Math.random() * 800));
        }
      } catch (e) {}
    }

    // Typing simulation
    if (botSettings.humanBehavior.typingEnabled) {
      try {
        const chat = (await whatsappClient.getChatById(pnChatId).catch(() => null)) ||
                     (await whatsappClient.getChatById(chatId).catch(() => null));
        if (chat && typeof chat.sendStateTyping === 'function') {
          await chat.sendStateTyping();
        }
      } catch (e) {}
      await sleep(typingDuration(String(message).length));
    }

    const candidateIds = [pnChatId];
    if (chatId !== pnChatId) candidateIds.push(chatId);

    let sentMessage = null;
    for (const targetId of candidateIds) {
      try {
        sentMessage = await whatsappClient.sendMessage(targetId, message);
        if (sentMessage) break;
      } catch (err) {
        console.warn(`[WhatsAppService] Send to ${targetId} attempt failed:`, err.message || err);
      }
    }

    if (!sentMessage) {
      console.error(`[WhatsAppService] Message send did not produce a confirmation for ${normalizedPhone}`);
      return false;
    }

    const msgId = (sentMessage.id && sentMessage.id._serialized) ? sentMessage.id._serialized : 'sent';
    console.log(`[WhatsAppService] Message delivered to ${normalizedPhone} (id: ${msgId})`);
    return true;
  } catch (error) {
    console.error(`[WhatsAppService] Send failed for ${normalizedPhone}:`, error.message || error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Incoming Message Listener & Conversational Bot
// ═══════════════════════════════════════════════════════════════════

async function handleIncomingWhatsAppMessage(message) {
  const text = (message.body || '').trim();
  const phone = normalizePhone(message.from.replace('@c.us', ''));
  const contactName = (message._data && message._data.notifyName) || '';

  // Forward to Customer Support Server
  let relayedToActiveTicket = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const eventRes = await fetch(`${SUPPORT_SERVICE_URL}/api/internal/whatsapp/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, contactName, body: text, type: 'text', status: 'received' }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (eventRes.ok) {
      const data = await eventRes.json();
      relayedToActiveTicket = Boolean(data.relayedToTicket);
    }
  } catch (e) {
    console.warn('[WhatsAppService] Could not reach Support Server for incoming event:', e.message);
  }

  // If already relayed directly to a human agent's open ticket chat, do not auto-respond
  if (relayedToActiveTicket) {
    return;
  }

  const waitMs = replyDelay();
  await sleep(waitMs);

  const response = await buildSupportResponse(text, phone);
  if (response) {
    try {
      await sendWhatsApp(phone, response, 'auto_reply');
    } catch (err) {
      console.error(`[WhatsAppService] Failed to send auto-reply to ${phone}:`, err.message || err);
    }
  }
}

async function buildSupportResponse(text, phone) {
  const relay = botSettings.botRelay || {};
  if (relay.enabled === false || relay.mode === 'manual') {
    return null;
  }

  const lower = text.toLowerCase().trim();
  const session = userSessions.get(phone);

  // Active Flowchart: awaiting category
  if (session && session.step === 'awaiting_category') {
    const category = HELP_CATEGORIES[lower];
    if (category) {
      userSessions.set(phone, { ...session, step: 'awaiting_order_id', category });
      return `Got it: *${category}*.\n\nPlease send your *Order ID* (e.g. 12-char code or full UUID).`;
    }
    return 'Please reply with a valid number (1, 2, 3, or 4).';
  }

  // Active Flowchart: awaiting order id
  if (session && session.step === 'awaiting_order_id') {
    const orderId = extractOrderId(text);
    if (orderId) {
      // Create ticket via Support Server
      try {
        await fetch(`${SUPPORT_SERVICE_URL}/api/tickets/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            userPhone: phone,
            category: session.category,
            description: `[WhatsApp] ${session.category} reported: ${text}`
          })
        });
      } catch (err) {
        console.error('[WhatsAppService] Failed to forward ticket creation to Support Server:', err.message);
      }

      userSessions.delete(phone);

      if (ADMIN_PHONE) {
        const adminMsg = [
          '🚨 *New Support Ticket Raised*',
          '',
          `📦 *Order ID:* ${orderId}`,
          `👤 *Customer:* ${phone}`,
          `🏷️ *Category:* ${session.category}`,
          `📝 *Message:* ${text}`,
          '',
          'Check the Customer Support Desk for live management.'
        ].join('\n');
        sendWhatsApp(ADMIN_PHONE, adminMsg, 'support').catch(() => {});
      }

      return `Thank you! Your ticket for order *${orderId}* has been opened. Our support desk will look into it right away.`;
    }
    return "I couldn't find a valid Order ID in your message. Please send your Order ID.";
  }

  // FAQ greetings
  if (['hi', 'hello', 'hey', 'start', 'help'].includes(lower)) {
    if (lower === 'help') {
      userSessions.set(phone, { step: 'awaiting_category', timestamp: Date.now() });
      return relay.customHelpMenu || HELP_MENU;
    }
    if (relay.customGreeting) return relay.customGreeting;
    return botSettings.messageVariety ? pickRandom(GREETING_VARIATIONS) : GREETING_VARIATIONS[0];
  }

  if (lower.includes('menu')) {
    return botSettings.messageVariety ? pickRandom(FAQ_MENU_VARIATIONS) : FAQ_MENU_VARIATIONS[0];
  }
  if (lower.includes('hour') || (lower.includes('time') && !lower.includes('status') && !lower.includes('eta'))) {
    return botSettings.messageVariety ? pickRandom(FAQ_HOURS_VARIATIONS) : FAQ_HOURS_VARIATIONS[0];
  }
  if (lower.includes('where') || lower.includes('location')) {
    return botSettings.messageVariety ? pickRandom(FAQ_LOCATION_VARIATIONS) : FAQ_LOCATION_VARIATIONS[0];
  }

  // Status or ETA query -> Fetch from Support Server summary
  if (lower.includes('status') || lower.includes('eta')) {
    const orderId = extractOrderId(text);
    try {
      const summaryRes = await fetch(`${SUPPORT_SERVICE_URL}/api/summary`);
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        const orders = data.orders || [];
        let order = null;
        if (orderId) {
          order = orders.find(o => 
            String(o.id).toLowerCase() === orderId.toLowerCase() || 
            String(o.id).toLowerCase().startsWith(orderId.toLowerCase())
          );
        } else {
          order = orders.filter(o => normalizePhone(o.userPhone) === normalizePhone(phone))[0];
        }

        if (order) {
          if (lower.includes('status')) {
            return `Order *${order.id}* is currently *${order.status}*. ETA: ${formatTime(order.etaTimestamp)}.`;
          }
          return `Estimated time for order *${order.id}*: ${formatTime(order.etaTimestamp)}.`;
        }
      }
    } catch (e) {}

    return orderId 
      ? `I couldn't locate order *${orderId}*. Please verify your order number.`
      : 'Please send your Order ID so I can look up the details.';
  }

  return "I'm not sure how to help with that. Type *help* to report a problem or *hi* to see menu and canteen info.";
}

// ═══════════════════════════════════════════════════════════════════
//  Express Microservice Endpoints
// ═══════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());

// Status & Health Check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ready: whatsappReady,
    status: whatsappStatus,
    info: whatsappClient && whatsappClient.info ? whatsappClient.info.wid : null
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    ready: whatsappReady,
    status: whatsappStatus,
    info: whatsappClient && whatsappClient.info ? whatsappClient.info.wid : null
  });
});

// Outgoing Send API (called by Support Server)
app.post('/api/send', async (req, res) => {
  const { phone, message, type = 'text' } = req.body || {};
  if (!phone || !message) {
    return res.status(400).json({ ok: false, error: 'Phone and message are required' });
  }

  if (!whatsappReady) {
    return res.status(503).json({ ok: false, error: 'WhatsApp is not ready / connected' });
  }

  const sent = await sendWhatsApp(phone, message, type);
  if (sent) {
    return res.json({ ok: true, phone, type });
  }
  res.status(502).json({ ok: false, error: 'WhatsApp delivery failed' });
});

// OTP Send API
app.post('/api/send-otp', async (req, res) => {
  if (INTERNAL_API_KEY) {
    const provided = Buffer.from(String(req.get('x-internal-api-key') || ''));
    const expected = Buffer.from(INTERNAL_API_KEY);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const phone = normalizePhone(req.body.phone);
  const otp = String(req.body.otp || '');
  const expiresInMinutes = Number(req.body.expiresInMinutes || 5);

  if (!phone || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ ok: false, error: 'Invalid phone or OTP format' });
  }

  if (!whatsappReady) {
    return res.status(503).json({ ok: false, error: 'WhatsApp is not ready' });
  }

  const message = `*OnFood account verification*\n\nYour verification code is: *${otp}*\nIt expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? '' : 's'}.\n\nDo not share this code with anyone.`;
  const sent = await sendWhatsApp(phone, message, 'otp');
  if (sent) {
    return res.json({ ok: true });
  }
  res.status(502).json({ ok: false, error: 'OTP delivery failed' });
});

// ═══════════════════════════════════════════════════════════════════
//  Start WhatsApp Microservice
// ═══════════════════════════════════════════════════════════════════

function startWhatsAppService() {
  app.listen(WHATSAPP_PORT, () => {
    console.log(`[WhatsAppService] Microservice HTTP API listening on port ${WHATSAPP_PORT}`);
    console.log(`[WhatsAppService] Initializing WhatsApp Web Client...`);
    setupWhatsApp();
  });
}

if (require.main === module) {
  startWhatsAppService();
}

module.exports = { app, startWhatsAppService, sendWhatsApp };
