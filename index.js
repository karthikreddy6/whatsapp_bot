const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const firebase = require('firebase/compat/app');
require('firebase/compat/database');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

let logFile = path.join(__dirname, 'bot.log');
try {
  if (fs.existsSync(logFile) && fs.statSync(logFile).isDirectory()) {
    logFile = path.join(logFile, 'bot.log');
  }
} catch (e) {}

let logStream = null;
try {
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.on('error', (err) => {
    // Prevent unhandled error event from crashing the server
  });
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

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadLocalEnvironment();

const PORT = Number(process.env.PORT || 3000);
const firebaseConfig = {
  apiKey: "AIzaSyBwYwaLjclLq9OHbjEhkUh-oKqV38qSEpk",
  authDomain: "onfood-587eb.firebaseapp.com",
  databaseURL: "https://onfood-587eb-default-rtdb.firebaseio.com",
  projectId: "onfood-587eb",
  storageBucket: "onfood-587eb.appspot.com",
  messagingSenderId: "576989448271",
  appId: "1:576989448271:web:bf0e0e7d47af87befa823a",
  measurementId: "G-E1S3MQP5RT"
};

let enableWhatsApp = process.env.ENABLE_WHATSAPP !== 'false';
const CANTEEN_WHATSAPP = normalizePhone(process.env.CANTEEN_WHATSAPP || '');
const ADMIN_PHONE = '9100064518';
const RECENT_WINDOW_MS = Number(process.env.RECENT_WINDOW_MS || 2 * 60 * 60 * 1000);
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const isRunningInDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);
const WHATSAPP_HEADLESS = isRunningInDocker || process.env.WHATSAPP_HEADLESS !== 'false';
const WHATSAPP_MESSAGE_DELAY_MS = Number(process.env.WHATSAPP_MESSAGE_DELAY_MS || 5000);
const HUMAN_TYPING_ENABLED = process.env.HUMAN_TYPING_ENABLED !== 'false';

const STATUS_FLOW = ['Pending', 'Preparing', 'Cooking', 'Ready for Pickup', 'Delivered'];
const STATUS_ALIASES = {
  pending: 'Pending',
  preparing: 'Preparing',
  cooking: 'Cooking',
  ready: 'Ready for Pickup',
  'ready for pickup': 'Ready for Pickup',
  delivered: 'Delivered',
  completed: 'Delivered',
  cancelled: 'Cancelled'
};

const STATUS_MESSAGE = {
  Pending: 'Your order was received. The canteen team will start preparing it shortly.',
  Preparing: 'Your order is being prepared now.',
  Cooking: 'Your food is cooking. We will notify you when it is ready.',
  'Ready for Pickup': 'Your order is ready. Please collect it from the canteen counter.',
  Delivered: 'Your order is completed. Thank you for ordering from OnFood.',
  Cancelled: 'Your order was cancelled. Please contact the canteen if this was unexpected.'
};

const FAQ_RESPONSES = {
  greeting: '👋 *Hello!* Welcome to OnFood Support.\n\nYou can ask about:\n- *status ORDERID* (check order)\n- *eta ORDERID* (check time)\n- *menu* (today\'s special)\n- *hours* (opening time)\n- *help* (report a problem)',
  hours: '🕒 *Canteen Hours:*\nMon-Fri: 8:30 AM - 6:00 PM\nSat: 9:00 AM - 4:00 PM\nSun: Closed',
  menu: '🍱 *Today\'s Special:*\nPlease check the OnFood app for the latest menu and special offers! We have fresh Masala Dosa and Veg Fried Rice today.',
  location: '📍 *Find Us:*\nWe are located at the Main Campus Canteen, Ground Floor.'
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

let whatsappClient = null;
let whatsappReady = !enableWhatsApp;
let whatsappRestartTimer = null;
let whatsappSendQueue = Promise.resolve();
let lastWhatsAppSentAt = 0;
let ordersCache = {};
let ticketsCache = {};
let bufferingTimeMinutes = 20;
const lastNotifiedStatus = new Map();
const alreadyNotifiedStuck = new Set();
const userSessions = new Map();
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

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

function getDynamicBuffer() {
  const activeCount = Object.values(ordersCache).filter(o => 
    !['Delivered', 'Cancelled'].includes(normalizeStatus(o.status))
  ).length;
  // Base 15 mins + 2 mins per active order, max 60
  return Math.min(15 + (activeCount * 2), 60);
}

function checkStuckOrders() {
  const now = Date.now();
  Object.entries(ordersCache).forEach(([id, rawOrder]) => {
    const order = normalizeOrder(id, rawOrder);
    if (['Delivered', 'Cancelled'].includes(order.status)) return;
    
    const timeSinceUpdate = now - order.updatedAt;
    if (timeSinceUpdate > STUCK_THRESHOLD_MS) {
      const stuckKey = `${id}-${order.status}`;
      if (!alreadyNotifiedStuck.has(stuckKey)) {
        notifyCanteen(`⚠️ Order ${id} stuck in ${order.status} for ${Math.round(timeSinceUpdate / 60000)}m!`);
        alreadyNotifiedStuck.add(stuckKey);
      }
    }
  });
}

setInterval(checkStuckOrders, 60000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

app.get('/api/summary', (req, res) => {
  res.json(buildDashboardState());
});

app.post('/internal/whatsapp/send-otp', async (req, res) => {
  if (!INTERNAL_API_KEY) return res.status(503).json({ error: 'Internal API key is not configured' });

  const provided = Buffer.from(String(req.get('x-internal-api-key') || ''));
  const expected = Buffer.from(INTERNAL_API_KEY);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = normalizePhone(req.body.phone);
  const otp = String(req.body.otp || '');
  const expiresInMinutes = Number(req.body.expiresInMinutes);
  if (!phone || !/^\d{6}$/.test(otp) || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 15) {
    return res.status(400).json({ error: 'Invalid OTP delivery request' });
  }
  if (!whatsappReady) return res.status(503).json({ error: 'WhatsApp client is not ready' });

  const message = `*OnFood account verification*\n\nYour verification code is: *${otp}*\nIt expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? '' : 's'}.\n\nDo not share this code with anyone.`;
  const sent = await sendWhatsApp(phone, message);
  if (!sent) return res.status(502).json({ error: 'WhatsApp message could not be sent' });
  res.json({ ok: true });
});

app.patch('/api/orders/:orderId/status', async (req, res) => {
  const status = normalizeStatus(req.body.status);
  if (!status) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const orderId = req.params.orderId;
  const updates = {
    status,
    updatedAt: Date.now()
  };

  if (status === 'Ready for Pickup') {
    updates.readyAt = Date.now();
  }

  if (status === 'Delivered') {
    updates.deliveredAt = Date.now();
  }

  await db.ref(`Orders/${orderId}`).update(updates);
  res.json({ ok: true, orderId, status });
});

app.post('/api/orders/:orderId/eta', async (req, res) => {
  const minutes = Number(req.body.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
    return res.status(400).json({ error: 'ETA minutes must be between 1 and 180' });
  }

  const etaTimestamp = Date.now() + minutes * 60 * 1000;
  await db.ref(`Orders/${req.params.orderId}`).update({
    etaTimestamp,
    updatedAt: Date.now()
  });

  res.json({ ok: true, orderId: req.params.orderId, etaTimestamp });
});

app.post('/api/tickets/:ticketId/resolve', async (req, res) => {
  await db.ref(`Tickets/${req.params.ticketId}`).update({
    status: 'Resolved',
    resolvedAt: Date.now()
  });

  res.json({ ok: true, ticketId: req.params.ticketId });
});

app.post('/api/tickets/:ticketId/reply', async (req, res) => {
  const message = req.body.message;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const ticketSnapshot = await db.ref(`Tickets/${req.params.ticketId}`).get();
  const ticket = ticketSnapshot.val();
  
  if (!ticket || !ticket.userPhone) {
    return res.status(404).json({ error: 'Ticket or customer phone not found' });
  }

  await sendWhatsApp(ticket.userPhone, `💬 *Staff Reply:*\n${message}`);
  
  await db.ref(`Tickets/${req.params.ticketId}`).update({
    status: 'Replied',
    lastReply: message,
    updatedAt: Date.now()
  });

  res.json({ ok: true });
});

app.post('/api/buffering-time', async (req, res) => {
  const minutes = Number(req.body.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
    return res.status(400).json({ error: 'Buffering time must be between 1 and 180 minutes' });
  }

  await db.ref('buffering_time').update({ time: minutes });
  res.json({ ok: true, minutes });
});

function listenForRealtimeData() {
  db.ref('Orders').on('value', snapshot => {
    ordersCache = snapshot.val() || {};
    emitDashboard();
  });

  db.ref('Tickets').on('value', snapshot => {
    ticketsCache = snapshot.val() || {};
    emitDashboard();
  });

  db.ref('buffering_time/time').on('value', snapshot => {
    bufferingTimeMinutes = Number(snapshot.val() || 20);
    emitDashboard();
  });

  const safeNotify = async (snapshot) => {
    try {
      await handleOrderNotification(snapshot.key, snapshot.val());
    } catch (error) {
      console.error('Error in order notification listener:', error);
    }
  };

  db.ref('Orders').on('child_added', safeNotify);
  db.ref('Orders').on('child_changed', safeNotify);
}

function buildDashboardState() {
  const now = Date.now();
  const dynamicBuffer = getDynamicBuffer();
  const orders = Object.entries(ordersCache)
    .map(([id, order]) => normalizeOrder(id, order))
    .sort((a, b) => b.timestamp - a.timestamp);
  const recentOrders = orders.filter(order => now - order.timestamp <= RECENT_WINDOW_MS);
  const tickets = Object.entries(ticketsCache)
    .map(([id, ticket]) => normalizeTicket(id, ticket))
    .sort((a, b) => b.timestamp - a.timestamp);

  const completedRecent = recentOrders.filter(order => order.deliveredAt || order.status === 'Delivered');
  const avgDeliveryMinutes = average(
    completedRecent
      .map(order => ((order.deliveredAt || now) - order.timestamp) / 60000)
      .filter(value => value >= 0)
  );
  const activeOrders = orders.filter(order => !['Delivered', 'Cancelled'].includes(order.status));
  const openTickets = tickets.filter(ticket => ticket.status !== 'Resolved');

  return {
    generatedAt: now,
    bufferingTimeMinutes,
    dynamicBuffer,
    whatsappReady,
    metrics: {
      activeOrders: activeOrders.length,
      recentOrders: recentOrders.length,
      openTickets: openTickets.length,
      avgDeliveryMinutes: round(avgDeliveryMinutes),
      lateOrders: activeOrders.filter(order => order.etaTimestamp && order.etaTimestamp < now).length
    },
    orders,
    recentOrders,
    tickets
  };
}

function normalizeOrder(id, order = {}) {
  const timestamp = Number(order.timestamp || order.createdAt || 0);
  const updatedAt = Number(order.updatedAt || timestamp);
  const etaTimestamp = Number(order.etaTimestamp || timestamp + bufferingTimeMinutes * 60 * 1000);
  const items = Object.values(order.items || {}).map(item => ({
    name: item.name || 'Item',
    quantity: Number(item.quantity || 1),
    price: Number(item.price || 0)
  }));

  const status = normalizeStatus(order.status) || order.status || 'Pending';
  const isStuck = !['Delivered', 'Cancelled'].includes(status) && (Date.now() - updatedAt > STUCK_THRESHOLD_MS);

  return {
    id,
    userId: order.userId || '',
    username: order.username || order.name || 'Customer',
    userPhone: order.userPhone || order.phone || '',
    amount: Number(order.amount || 0),
    status,
    timestamp,
    etaTimestamp,
    updatedAt,
    isStuck,
    readyAt: Number(order.readyAt || 0),
    deliveredAt: Number(order.deliveredAt || 0),
    orderDate: order.orderDate || '',
    orderTime: order.orderTime || '',
    items
  };
}

function normalizeTicket(id, ticket = {}) {
  return {
    id,
    orderId: ticket.orderId || id,
    userId: ticket.userId || '',
    description: ticket.description || '',
    status: ticket.status || 'Open',
    timestamp: Number(ticket.timestamp || 0)
  };
}

function normalizeStatus(status) {
  if (!status) return null;
  return STATUS_ALIASES[String(status).trim().toLowerCase()] || null;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function emitDashboard() {
  io.emit('dashboard:update', buildDashboardState());
}

async function handleOrderNotification(orderId, rawOrder) {
  const order = normalizeOrder(orderId, rawOrder);
  if (!order.userPhone || !whatsappReady) return;

  const previousStatus = lastNotifiedStatus.get(orderId);
  if (previousStatus === order.status) return;
  lastNotifiedStatus.set(orderId, order.status);

  const message = previousStatus
    ? buildStatusMessage(order)
    : buildNewOrderMessage(order);

  await sendWhatsApp(order.userPhone, message);
}

function buildNewOrderMessage(order) {
  const itemsText = order.items
    .map(item => `- ${item.name} x${item.quantity} - Rs.${item.price}`)
    .join('\n');
  const etaText = order.etaTimestamp ? `\nETA: ${formatTime(order.etaTimestamp)}` : '';

  return [
    '*OnFood order received*',
    '',
    `Order: ${order.id}`,
    `Customer: ${order.username}`,
    `Amount: Rs.${order.amount}`,
    etaText.trim(),
    '',
    'Items:',
    itemsText || '- No items listed',
    '',
    basicSupportText(order)
  ].filter(Boolean).join('\n');
}

function buildStatusMessage(order) {
  const statusText = STATUS_MESSAGE[order.status] || `Your order status is now ${order.status}.`;
  return [
    '*OnFood order update*',
    '',
    `Order: ${order.id}`,
    `Status: ${order.status}`,
    `ETA: ${formatTime(order.etaTimestamp)}`,
    '',
    statusText,
    '',
    basicSupportText(order)
  ].join('\n');
}

function basicSupportText(order) {
  return `Need help? Reply with "status ${order.id}", "eta ${order.id}", or "help ${order.id}".`;
}

function clearChromiumLocks() {
  const sessionDir = path.join(__dirname, '.wwebjs_auth', 'session-onfood-support');
  if (fs.existsSync(sessionDir)) {
    for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = path.join(sessionDir, file);
      try {
        if (fs.existsSync(lockPath) || fs.lstatSync(lockPath)) {
          fs.unlinkSync(lockPath);
          console.log(`Cleaned up stale Chromium lock: ${file}`);
        }
      } catch (e) {
        // ignore
      }
    }
  }
}

async function installSendMessagePatch(pupPage) {
  if (!pupPage) return;
  try {
    await pupPage.evaluate(() => {
      if (window.WWebJS && !window.WWebJS._sendMessagePatched) {
        const origSend = window.WWebJS.sendMessage;
        window.WWebJS.sendMessage = async function(chat, content, options) {
          const res = await origSend.call(this, chat, content, options);
          if (res) return res;
          // Modern WhatsApp Web stores outgoing message in chat.msgs rather than WAWebCollections.Msg
          if (chat && chat.msgs && chat.msgs.length) {
            const last = chat.msgs.last();
            if (last) return last;
          }
          return null;
        };
        window.WWebJS._sendMessagePatched = true;
      }
    });
  } catch (e) {
    // ignore
  }
}

function setupWhatsApp() {
  if (!enableWhatsApp) {
    console.log('WhatsApp disabled. Set ENABLE_WHATSAPP=true to enable it.');
    return;
  }

  clearChromiumLocks();

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      clientId: "onfood-support"
    }),
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

  whatsappClient.on('qr', qr => qrcode.generate(qr, { small: true }));
  whatsappClient.on('ready', async () => {
    whatsappReady = true;
    const version = await whatsappClient.getWWebVersion().catch(() => 'unknown');
    console.log(`WhatsApp client is ready. Version: ${version}. Logged in account:`, whatsappClient.info ? JSON.stringify(whatsappClient.info.wid) : 'unknown');
    await installSendMessagePatch(whatsappClient.pupPage);
    emitDashboard();
  });
  whatsappClient.on('message', handleIncomingWhatsAppMessage);
  whatsappClient.on('error', error => console.error('WhatsApp error:', error));
  whatsappClient.on('auth_failure', reason => scheduleWhatsAppRestart(`authentication failed: ${reason}`));
  whatsappClient.on('disconnected', reason => scheduleWhatsAppRestart(`disconnected: ${reason}`));
  whatsappClient.initialize().catch(error => scheduleWhatsAppRestart(error.message || error));
}

function scheduleWhatsAppRestart(reason) {
  whatsappReady = false;
  console.error(`WhatsApp initialization failed: ${reason}`);
  if (!enableWhatsApp || whatsappRestartTimer) return;

  const failedClient = whatsappClient;
  whatsappRestartTimer = setTimeout(() => {
    whatsappRestartTimer = null;
    setupWhatsApp();
  }, 5000);

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
  console.error('Unhandled promise rejection:', reason);
});

async function handleIncomingWhatsAppMessage(message) {
  const text = (message.body || '').trim();
  const phone = normalizePhone(message.from.replace('@c.us', ''));
  const response = await buildSupportResponse(text, phone);

  if (response) {
    await message.reply(response);
  }
}

async function buildSupportResponse(text, phone) {
  const lower = text.toLowerCase().trim();
  const session = userSessions.get(phone);

  // 1. Handle Active Session (Flowchart)
  if (session && session.step === 'awaiting_category') {
    const category = HELP_CATEGORIES[lower];
    if (category) {
      userSessions.set(phone, { ...session, step: 'awaiting_order_id', category });
      return `Got it: *${category}*.\n\nPlease send your *12-character Order ID* (e.g., ABCD12345678).`;
    }
    return 'Please reply with a valid number (1, 2, 3, or 4).';
  }

  if (session && session.step === 'awaiting_order_id') {
    const orderId = extractOrderId(text);
    if (orderId) {
      const ticketData = {
        orderId,
        description: `[${session.category}] ${text}`,
        status: 'Open',
        timestamp: Date.now(),
        userPhone: phone
      };
      
      await db.ref(`Tickets/${orderId}`).set(ticketData);
      userSessions.delete(phone);
      
      // Notify Canteen
      notifyCanteen(`🆕 Ticket for ${orderId}: ${session.category}`);
      
      // Notify Admin with full details
      const adminMessage = [
        '🚩 *New Support Ticket Raised*',
        '',
        `🆔 *Order ID:* ${orderId}`,
        `👤 *Customer:* ${phone}`,
        `🏷️ *Category:* ${session.category}`,
        `📝 *Description:* ${text}`,
        '',
        'Please check the dashboard for more details.'
      ].join('\n');
      await sendWhatsApp(ADMIN_PHONE, adminMessage);
      
      return `Thank you! Your ticket for order *${orderId}* has been opened. Our team will check it shortly.`;
    }
    return 'I couldn\'t find a valid Order ID in your message. Please send the 12-character ID.';
  }

  // 2. Handle FAQs
  if (['hi', 'hello', 'hey', 'start', 'help'].includes(lower)) {
    if (lower === 'help') {
      userSessions.set(phone, { step: 'awaiting_category', timestamp: Date.now() });
      return HELP_MENU;
    }
    return FAQ_RESPONSES.greeting;
  }
  if (lower.includes('menu')) return FAQ_RESPONSES.menu;
  if (lower.includes('hour') || lower.includes('time')) return FAQ_RESPONSES.hours;
  if (lower.includes('where') || lower.includes('location')) return FAQ_RESPONSES.location;

  // 3. Handle Order Status/ETA (Existing)
  const orderId = extractOrderId(text);
  const order = orderId ? normalizeOrder(orderId, ordersCache[orderId]) : findLatestOrderByPhone(phone);

  if (lower.includes('status')) {
    if (!order) return 'I could not find your order. Please send your order ID.';
    return `Order *${order.id}* is *${order.status}*. ETA: ${formatTime(order.etaTimestamp)}.`;
  }

  if (lower.includes('eta') || lower.includes('time')) {
    if (!order) return 'Please send your order ID so I can check the ETA.';
    return `Estimated time for order *${order.id}*: ${formatTime(order.etaTimestamp)}.`;
  }

  return 'I\'m not sure how to help with that. Type *help* to report a problem or *hi* to see what I can do.';
}

function extractOrderId(text) {
  const match = text.match(/[A-Za-z]{4}\d{8}/);
  return match ? match[0].toUpperCase() : null;
}

function findLatestOrderByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  return Object.entries(ordersCache)
    .map(([id, order]) => normalizeOrder(id, order))
    .filter(order => normalizePhone(order.userPhone) === normalizedPhone)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

async function notifyCanteen(message) {
  if (!CANTEEN_WHATSAPP || !whatsappReady) return;
  await sendWhatsApp(CANTEEN_WHATSAPP, message);
}

function sendWhatsApp(phone, message) {
  const queuedSend = whatsappSendQueue.then(async () => {
    const waitMs = Math.max(0, WHATSAPP_MESSAGE_DELAY_MS - (Date.now() - lastWhatsAppSentAt));
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const sent = await sendWhatsAppNow(phone, message);
    if (sent) lastWhatsAppSentAt = Date.now();
    return sent;
  });
  whatsappSendQueue = queuedSend.catch(() => false);
  return queuedSend;
}

async function sendWhatsAppNow(phone, message) {
  if (!whatsappClient || !whatsappReady) return false;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return false;

  try {
    console.log(`Checking number registration for ${normalizedPhone}...`);
    const numberId = await whatsappClient.getNumberId(normalizedPhone);
    if (!numberId) {
      console.error(`WhatsApp number is not registered: ${normalizedPhone}`);
      return false;
    }
    const chatId = numberId._serialized;
    const pnChatId = `${normalizedPhone}@c.us`;

    // Ensure modern WhatsApp Web outgoing message resolution patch is active
    await installSendMessagePatch(whatsappClient.pupPage);

    if (HUMAN_TYPING_ENABLED) {
      try {
        const chat = (await whatsappClient.getChatById(pnChatId).catch(() => null)) || 
                     (await whatsappClient.getChatById(chatId).catch(() => null));
        if (chat && typeof chat.sendStateTyping === 'function') {
          await chat.sendStateTyping();
        }
      } catch (typingError) {
        // Typing indicator is best-effort
      }
      const typingDelay = Math.min(3500, 900 + (String(message).length * 18) + Math.floor(Math.random() * 700));
      await new Promise(resolve => setTimeout(resolve, typingDelay));
    }

    // Try sending to phone number chat ID first, then resolved ID if different
    const candidateIds = [pnChatId];
    if (chatId !== pnChatId) candidateIds.push(chatId);

    let sentMessage = null;
    for (const targetId of candidateIds) {
      try {
        sentMessage = await whatsappClient.sendMessage(targetId, message);
        if (sentMessage) {
          break;
        }
      } catch (err) {
        console.warn(`Send to ${targetId} failed:`, err.message || err);
      }
    }

    if (!sentMessage) {
      console.error(`WhatsApp did not create an outgoing message for ${normalizedPhone}`);
      return false;
    }
    const msgId = (sentMessage.id && sentMessage.id._serialized) ? sentMessage.id._serialized : 'sent';
    console.log(`WhatsApp message sent to ${normalizedPhone}; id=${msgId}`);
    return true;
  } catch (error) {
    console.error(`WhatsApp send failed for ${normalizedPhone}:`, error.stack || error.message || error);
    return false;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return 'not set';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(timestamp));
}

io.on('connection', socket => {
  socket.emit('dashboard:update', buildDashboardState());
});

listenForRealtimeData();
setupWhatsApp();

server.listen(PORT, () => {
  console.log(`OnFood support dashboard running at http://localhost:${PORT}`);
});
