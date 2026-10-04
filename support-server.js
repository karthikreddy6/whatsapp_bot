const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const {
  loadLocalEnvironment,
  DEFAULT_SETTINGS,
  deepClone,
  mergeSettings,
  DB_TO_UI_STATUS,
  UI_TO_DB_STATUS,
  STATUS_ALIASES,
  STUCK_THRESHOLD_MS,
  normalizePhone,
  normalizeStatus,
  normalizeOrder,
  normalizeTicket,
  formatTime,
  extractOrderId
} = require('./shared');

// ═══════════════════════════════════════════════════════════════════
//  Environment & Configuration
// ═══════════════════════════════════════════════════════════════════

loadLocalEnvironment();

const PORT = Number(process.env.PORT || 3000);
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://127.0.0.1:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const CANTEEN_WHATSAPP = normalizePhone(process.env.CANTEEN_WHATSAPP || '');
const RECENT_WINDOW_MS = Number(process.env.RECENT_WINDOW_MS || 2 * 60 * 60 * 1000);
const isRunningInDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);

// ═══════════════════════════════════════════════════════════════════
//  PostgreSQL Pool
// ═══════════════════════════════════════════════════════════════════

const pgPool = new Pool({
  host: process.env.PG_HOST || (isRunningInDocker ? 'onfood-postgres' : 'localhost'),
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'BUVVA',
  password: process.env.PG_PASSWORD || 'BUVA@KR',
  database: process.env.PG_DATABASE || 'onfood',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pgPool.on('error', (err) => {
  console.error('[SupportServer] Unexpected error on idle PostgreSQL client:', err.message);
});

// ═══════════════════════════════════════════════════════════════════
//  State & Settings
// ═══════════════════════════════════════════════════════════════════

let botSettings = deepClone(DEFAULT_SETTINGS);
let ordersCache = {};
let ticketsCache = {};
const lastNotifiedStatus = new Map();
const alreadyNotifiedStuck = new Set();

let whatsappServiceStatus = {
  ready: false,
  status: 'disconnected',
  info: null,
  lastChecked: 0
};

class MessageLog {
  constructor(maxSize = 500) {
    this.messages = [];
    this.maxSize = maxSize;
  }

  add(msg) {
    const entry = {
      id: crypto.randomUUID(),
      direction: msg.direction || 'outgoing',
      phone: msg.phone,
      contactName: msg.contactName || '',
      body: msg.body,
      timestamp: msg.timestamp || Date.now(),
      type: msg.type || 'text',
      status: msg.status || 'sent',
    };
    this.messages.push(entry);
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
    return entry;
  }

  getAll() {
    return [...this.messages];
  }

  getByPhone(phone) {
    const normalized = normalizePhone(phone);
    return this.messages.filter(m => normalizePhone(m.phone) === normalized);
  }

  getRecent(count = 100) {
    return this.messages.slice(-count);
  }
}

const messageLog = new MessageLog(500);

async function saveBotSettings() {
  try {
    await pgPool.query(
      `INSERT INTO bot_settings (key, value, updated_at) 
       VALUES ('config', $1, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(botSettings)]
    );
  } catch (err) {
    console.error('[SupportServer] Failed to persist bot settings to postgres:', err.message);
  }
}

async function loadBotSettings() {
  try {
    const res = await pgPool.query(`SELECT value FROM bot_settings WHERE key = 'config' LIMIT 1`);
    if (res.rows.length > 0 && res.rows[0].value) {
      botSettings = mergeSettings(deepClone(DEFAULT_SETTINGS), res.rows[0].value);
    }
  } catch (err) {
    console.error('[SupportServer] Failed to load bot settings from postgres:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  WhatsApp Microservice Client (Decoupled Bridge)
// ═══════════════════════════════════════════════════════════════════

async function checkWhatsAppHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/api/status`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      whatsappServiceStatus = {
        ready: Boolean(data.ready),
        status: data.status || (data.ready ? 'ready' : 'connecting'),
        info: data.info || null,
        lastChecked: Date.now()
      };
    } else {
      whatsappServiceStatus = { ready: false, status: 'error', info: null, lastChecked: Date.now() };
    }
  } catch (err) {
    whatsappServiceStatus = { ready: false, status: 'offline', info: null, lastChecked: Date.now() };
  }
}

setInterval(checkWhatsAppHealth, 4000);

async function sendWhatsAppMessage(phone, message, type = 'text') {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { ok: false, error: 'Invalid phone number' };

  if (!whatsappServiceStatus.ready) {
    return { ok: false, error: 'WhatsApp service is currently offline or not ready' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalizedPhone, message, type }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (res.ok && data.ok) {
      const entry = messageLog.add({
        direction: 'outgoing',
        phone: normalizedPhone,
        body: message,
        type,
        status: 'sent'
      });
      emitNewMessage(entry);
      return { ok: true, messageId: data.messageId };
    }
    return { ok: false, error: data.error || 'Failed to send WhatsApp message' };
  } catch (err) {
    console.warn(`[SupportServer] WhatsApp forward failed to ${normalizedPhone}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendWhatsAppOtp(phone, otp, expiresInMinutes) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${WHATSAPP_SERVICE_URL}/api/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY
      },
      body: JSON.stringify({ phone, otp, expiresInMinutes }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await res.json();
    return { ok: res.ok && data.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 503, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers & Calculation
// ═══════════════════════════════════════════════════════════════════

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function getDynamicBuffer() {
  const activeCount = Object.values(ordersCache).filter(o => {
    const s = DB_TO_UI_STATUS[o.status] || o.status;
    return !['Delivered', 'Cancelled'].includes(s);
  }).length;
  return Math.min(15 + (activeCount * 2), 60);
}

function findOrderById(id) {
  if (!id) return null;
  const clean = String(id).trim().toLowerCase();
  if (ordersCache[id]) return ordersCache[id];
  return Object.values(ordersCache).find(o => 
    String(o.id).toLowerCase() === clean || 
    String(o.id).toLowerCase().startsWith(clean) || 
    (o.orderToken && String(o.orderToken).toLowerCase() === clean)
  ) || null;
}

function buildDashboardState() {
  const now = Date.now();
  const dynamicBuffer = getDynamicBuffer();
  const orders = Object.entries(ordersCache)
    .map(([id, order]) => normalizeOrder(id, order, botSettings.bufferingTimeMinutes))
    .sort((a, b) => b.timestamp - a.timestamp);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const todayOrders = orders.filter(order => order.timestamp >= startOfTodayMs);
  const todayRevenue = todayOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
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
  const repliedTickets = tickets.filter(ticket => ticket.status === 'Replied');
  const resolvedTickets = tickets.filter(ticket => ticket.status === 'Resolved');

  const delayedOrders = activeOrders
    .filter(order => (order.etaTimestamp && order.etaTimestamp < now) || order.isStuck)
    .map(order => {
      const referenceTime = (order.etaTimestamp && order.etaTimestamp < now)
        ? order.etaTimestamp
        : order.updatedAt;
      const delayMinutes = Math.max(1, Math.round((now - referenceTime) / 60000));
      return {
        ...order,
        delayMinutes,
        delayReason: order.isStuck
          ? `Stuck in ${order.status} (${Math.round((now - order.updatedAt) / 60000)}m)`
          : `Past ETA by ${delayMinutes}m`,
        urgency: delayMinutes >= 20 ? 'critical' : (delayMinutes >= 10 ? 'high' : 'moderate')
      };
    })
    .sort((a, b) => b.delayMinutes - a.delayMinutes);

  const statusCounts = {
    Pending: 0,
    Preparing: 0,
    Cooking: 0,
    'Ready for Pickup': 0,
    Delivered: 0,
    Cancelled: 0
  };
  orders.forEach(order => {
    if (statusCounts[order.status] !== undefined) {
      statusCounts[order.status]++;
    } else {
      statusCounts.Pending++;
    }
  });

  const hourlyOrders = Array(24).fill(0);
  const hourlyTickets = Array(24).fill(0);
  todayOrders.forEach(o => {
    if (o.timestamp) {
      const hour = new Date(o.timestamp).getHours();
      hourlyOrders[hour]++;
    }
  });
  tickets.forEach(t => {
    if (t.timestamp && t.timestamp >= startOfTodayMs) {
      const hour = new Date(t.timestamp).getHours();
      hourlyTickets[hour]++;
    }
  });

  return {
    generatedAt: now,
    bufferingTimeMinutes: botSettings.bufferingTimeMinutes,
    dynamicBuffer,
    whatsappReady: whatsappServiceStatus.ready,
    whatsappStatus: whatsappServiceStatus.status,
    metrics: {
      todayOrdersCount: todayOrders.length,
      todayRevenue: Math.round(todayRevenue),
      activeOrders: activeOrders.length,
      recentOrders: recentOrders.length,
      delayedOrdersCount: delayedOrders.length,
      openTickets: openTickets.length,
      repliedTickets: repliedTickets.length,
      resolvedTickets: resolvedTickets.length,
      avgDeliveryMinutes: round(avgDeliveryMinutes),
      lateOrders: delayedOrders.length,
      totalOrdersCount: orders.length
    },
    statusCounts,
    hourlyActivity: {
      labels: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`),
      orders: hourlyOrders,
      tickets: hourlyTickets
    },
    delayedOrders,
    orders,
    recentOrders,
    tickets
  };
}

function buildNewOrderMessage(order) {
  const itemsText = (order.items || [])
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
    `Need help? Reply with "status ${order.id}" or "help".`
  ].filter(Boolean).join('\n');
}

function buildStatusMessage(order) {
  return [
    '*OnFood order update*',
    '',
    `Order: ${order.id}`,
    `Status: ${order.status}`,
    `ETA: ${formatTime(order.etaTimestamp)}`,
    '',
    `Your order status is now ${order.status}.`,
    '',
    `Need help? Reply with "status ${order.id}" or "help".`
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════
//  Stuck Orders Checker
// ═══════════════════════════════════════════════════════════════════

function checkStuckOrders() {
  const now = Date.now();
  Object.entries(ordersCache).forEach(([id, rawOrder]) => {
    const order = normalizeOrder(id, rawOrder, botSettings.bufferingTimeMinutes);
    if (['Delivered', 'Cancelled'].includes(order.status)) return;

    const timeSinceUpdate = now - order.updatedAt;
    if (timeSinceUpdate > STUCK_THRESHOLD_MS) {
      const stuckKey = `${id}-${order.status}`;
      if (!alreadyNotifiedStuck.has(stuckKey)) {
        if (CANTEEN_WHATSAPP && whatsappServiceStatus.ready) {
          sendWhatsAppMessage(
            CANTEEN_WHATSAPP,
            `⚠️ Alert: Order ${id} stuck in ${order.status} for ${Math.round(timeSinceUpdate / 60000)}m!`,
            'support'
          ).catch(() => {});
        }
        alreadyNotifiedStuck.add(stuckKey);
      }
    }
  });
}

setInterval(checkStuckOrders, 60000);

// ═══════════════════════════════════════════════════════════════════
//  PostgreSQL Realtime Sync Engine
// ═══════════════════════════════════════════════════════════════════

async function syncPostgresData(forceEmit = false) {
  try {
    const ordersRes = await pgPool.query(`
      SELECT 
        o.id::text as id,
        o.user_id,
        COALESCE(u.name, 'Customer') as username,
        COALESCE(u.phone, '') as user_phone,
        o.total_amount::float as amount,
        o.status::text as status,
        o.created_at,
        o.updated_at,
        o.estimated_ready_at,
        o.actual_ready_at,
        o.order_token,
        o.pickup_number,
        COALESCE(json_agg(
          json_build_object(
            'id', oi.id::text,
            'name', COALESCE(m.name, 'Food Item'),
            'quantity', oi.quantity,
            'price', oi.price_at_time_of_order::float
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) as items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      GROUP BY o.id, o.user_id, u.name, u.phone, o.total_amount, o.status, o.created_at, o.updated_at, o.estimated_ready_at, o.actual_ready_at, o.order_token, o.pickup_number
      ORDER BY o.created_at DESC
    `);

    const newOrdersMap = {};
    for (const row of ordersRes.rows) {
      const id = row.id;
      const normalizedStatus = DB_TO_UI_STATUS[row.status] || row.status || 'Pending';
      const timestamp = row.created_at ? new Date(row.created_at).getTime() : Date.now();
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : timestamp;
      const etaTimestamp = row.estimated_ready_at 
        ? new Date(row.estimated_ready_at).getTime() 
        : timestamp + (botSettings.bufferingTimeMinutes * 60 * 1000);
      const readyAt = row.actual_ready_at ? new Date(row.actual_ready_at).getTime() : 0;
      const deliveredAt = (row.status === 'DELIVERED' && row.actual_ready_at) ? new Date(row.actual_ready_at).getTime() : (row.status === 'DELIVERED' ? updatedAt : 0);

      newOrdersMap[id] = {
        id,
        userId: row.user_id || '',
        username: row.username,
        userPhone: row.user_phone,
        amount: Number(row.amount || 0),
        status: normalizedStatus,
        rawStatus: row.status,
        timestamp,
        updatedAt,
        etaTimestamp,
        readyAt,
        deliveredAt,
        orderToken: row.order_token || '',
        pickupNumber: row.pickup_number || '',
        items: row.items || []
      };

      // Status change / new order WhatsApp notification
      if (whatsappServiceStatus.ready && row.user_phone) {
        const prevStatus = lastNotifiedStatus.get(id);
        if (!prevStatus) {
          lastNotifiedStatus.set(id, normalizedStatus);
          if (Date.now() - timestamp < 10 * 60 * 1000) {
            const normalizedOrder = normalizeOrder(id, newOrdersMap[id], botSettings.bufferingTimeMinutes);
            sendWhatsAppMessage(row.user_phone, buildNewOrderMessage(normalizedOrder), 'order').catch(() => {});
          }
        } else if (prevStatus !== normalizedStatus) {
          lastNotifiedStatus.set(id, normalizedStatus);
          const normalizedOrder = normalizeOrder(id, newOrdersMap[id], botSettings.bufferingTimeMinutes);
          sendWhatsAppMessage(row.user_phone, buildStatusMessage(normalizedOrder), 'status').catch(() => {});
        }
      }
    }
    ordersCache = newOrdersMap;

    const ticketsRes = await pgPool.query(`
      SELECT 
        t.id::text as id,
        COALESCE(t.order_id, t.id::text) as order_id,
        t.user_id,
        COALESCE(u.phone, '') as user_phone,
        COALESCE(u.name, 'Customer') as customer_name,
        t.subject,
        COALESCE(t.message, '') as description,
        t.status::text as status,
        t.created_at,
        COALESCE(t.updated_at, t.created_at) as updated_at,
        COALESCE(m.last_message, '') as last_reply
      FROM support_tickets t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT message as last_message 
        FROM support_messages 
        WHERE ticket_id = t.id AND sender_type = 'AGENT' 
        ORDER BY created_at DESC 
        LIMIT 1
      ) m ON true
      ORDER BY t.created_at DESC
    `);

    const newTicketsMap = {};
    for (const row of ticketsRes.rows) {
      const id = row.id;
      let uiStatus = 'Open';
      if (row.status === 'RESOLVED') uiStatus = 'Resolved';
      else if (row.status === 'IN_PROGRESS' || row.last_reply) uiStatus = 'Replied';

      newTicketsMap[id] = {
        id,
        orderId: row.order_id || id,
        userId: row.user_id || '',
        userPhone: row.user_phone || '',
        customerName: row.customer_name || 'Customer',
        description: row.description || row.subject || '',
        status: uiStatus,
        lastReply: row.last_reply || '',
        timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
      };
    }
    ticketsCache = newTicketsMap;

    emitDashboard();
  } catch (err) {
    console.error('[SupportServer] Error synchronizing with PostgreSQL:', err.message || err);
  }
}

function startPostgresSync() {
  loadBotSettings().then(() => {
    emitSettings();
    return syncPostgresData(true);
  });
  setInterval(() => {
    syncPostgresData(false);
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════
//  Express App & Socket.IO Setup
// ═══════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function emitDashboard() {
  io.emit('dashboard:update', buildDashboardState());
}

function emitNewMessage(msg) {
  io.emit('messages:new', msg);
}

function emitSettings() {
  io.emit('settings:update', botSettings);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/api/summary', (req, res) => {
  res.json(buildDashboardState());
});

app.get('/api/messages', (req, res) => {
  const phone = req.query.phone;
  const messages = phone ? messageLog.getByPhone(phone) : messageLog.getAll();
  res.json({ messages });
});

app.get('/api/settings', (req, res) => {
  res.json(botSettings);
});

app.post('/api/settings', async (req, res) => {
  try {
    const updates = req.body;
    mergeSettings(botSettings, updates);
    await saveBotSettings();
    emitSettings();
    res.json({ ok: true, settings: botSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/reset', async (req, res) => {
  try {
    botSettings = deepClone(DEFAULT_SETTINGS);
    await saveBotSettings();
    emitSettings();
    res.json({ ok: true, settings: botSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Outbound message from dashboard drawer
app.post('/api/messages/send', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const message = String(req.body.message || '').trim();
  const channel = String(req.body.channel || 'WHATSAPP').toUpperCase();

  if (!phone || phone.length < 10) {
    return res.status(400).json({ error: 'Valid phone number is required (10 digits)' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Message text cannot be empty' });
  }

  let sentWhatsApp = false;
  let whatsappError = null;

  if (channel === 'WHATSAPP' || channel === 'BOTH') {
    if (!whatsappServiceStatus.ready) {
      whatsappError = 'WhatsApp service is not connected';
      if (channel === 'WHATSAPP') {
        return res.status(503).json({ error: whatsappError });
      }
    } else {
      const sendRes = await sendWhatsAppMessage(phone, message, 'text');
      sentWhatsApp = sendRes.ok;
      if (!sentWhatsApp) whatsappError = sendRes.error;
    }
  }

  // Check if customer has an active ticket to mirror to ticket history
  const ticket = Object.values(ticketsCache).find(t => 
    t.userPhone && normalizePhone(t.userPhone) === normalizePhone(phone)
  );
  if (ticket) {
    try {
      const ins = await pgPool.query(
        `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
         VALUES ($1, 'AGENT', 'agent_desk', 'Support Agent', $2, $3)
         RETURNING id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at`,
        [ticket.id, message, channel]
      );
      io.to(`ticket:${ticket.id}`).emit('ticket:message', ins.rows[0]);
      await syncPostgresData(true);
    } catch (e) {
      console.warn('[SupportServer] Failed to mirror drawer message to support_messages:', e.message);
    }
  }

  res.json({ ok: true, phone, message, channel, sentWhatsApp, whatsappError });
});

// Protected OTP endpoint for FastAPI
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

  if (!whatsappServiceStatus.ready) {
    return res.status(503).json({ error: 'WhatsApp service is not ready' });
  }

  const result = await sendWhatsAppOtp(phone, otp, expiresInMinutes);
  if (!result.ok) {
    return res.status(result.status || 502).json({ error: result.error || 'WhatsApp message could not be sent' });
  }
  res.json({ ok: true });
});

// Order status change
app.patch('/api/orders/:orderId/status', async (req, res) => {
  const status = req.body.status;
  const dbStatus = UI_TO_DB_STATUS[String(status).trim().toLowerCase()];
  if (!dbStatus) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const orderId = req.params.orderId;
  try {
    let updateQuery = `UPDATE orders SET status = $1::order_status, updated_at = NOW()`;
    const params = [dbStatus, orderId];
    if (dbStatus === 'READY_FOR_PICKUP') {
      updateQuery += `, actual_ready_at = NOW()`;
    }
    updateQuery += ` WHERE id = $2`;

    await pgPool.query(updateQuery, params);
    await syncPostgresData(true);
    res.json({ ok: true, orderId, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order ETA set
app.post('/api/orders/:orderId/eta', async (req, res) => {
  const minutes = Number(req.body.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
    return res.status(400).json({ error: 'ETA minutes must be between 1 and 180' });
  }

  const etaTimestamp = Date.now() + minutes * 60 * 1000;
  const orderId = req.params.orderId;
  try {
    await pgPool.query(
      `UPDATE orders SET estimated_ready_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(etaTimestamp), orderId]
    );
    await syncPostgresData(true);
    res.json({ ok: true, orderId, etaTimestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order bump ETA
app.post('/api/orders/:orderId/bump-eta', async (req, res) => {
  const orderId = req.params.orderId;
  const minutes = Number(req.body.minutes || 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
    return res.status(400).json({ error: 'Minutes must be between 1 and 180' });
  }

  const rawOrder = ordersCache[orderId];
  if (!rawOrder) return res.status(404).json({ error: 'Order not found' });
  const order = normalizeOrder(orderId, rawOrder, botSettings.bufferingTimeMinutes);

  const baseTime = (order.etaTimestamp && order.etaTimestamp > Date.now()) ? order.etaTimestamp : Date.now();
  const newEta = baseTime + minutes * 60 * 1000;

  try {
    await pgPool.query(
      `UPDATE orders SET estimated_ready_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(newEta), orderId]
    );
    await syncPostgresData(true);
    res.json({ ok: true, orderId, etaTimestamp: newEta, addedMinutes: minutes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order delay alert
app.post('/api/orders/:orderId/delay-alert', async (req, res) => {
  const orderId = req.params.orderId;
  const minutes = Number(req.body.minutes || 10);
  const rawOrder = ordersCache[orderId];
  if (!rawOrder) return res.status(404).json({ error: 'Order not found' });
  const order = normalizeOrder(orderId, rawOrder, botSettings.bufferingTimeMinutes);

  if (!order.userPhone) {
    return res.status(400).json({ error: 'Customer phone number not available' });
  }

  const baseTime = (order.etaTimestamp && order.etaTimestamp > Date.now()) ? order.etaTimestamp : Date.now();
  const newEta = baseTime + minutes * 60 * 1000;

  try {
    await pgPool.query(
      `UPDATE orders SET estimated_ready_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(newEta), orderId]
    );
  } catch (err) {
    console.warn('[SupportServer] Failed to update estimated_ready_at in postgres:', err.message);
  }

  const etaStr = formatTime(newEta);
  const msg = req.body.message || [
    `🔔 *Update on your OnFood Order #${order.id}*`,
    ``,
    `Hi ${order.username || 'Customer'}, your meal is currently being freshly prepared by our chefs.`,
    `Due to high kitchen volume, estimated readiness is now *${etaStr}* (~${minutes} min buffer).`,
    ``,
    `We apologize for the brief wait and appreciate your understanding! 🙏`
  ].join('\n');

  let sent = false;
  if (whatsappServiceStatus.ready) {
    const sendResult = await sendWhatsAppMessage(order.userPhone, msg, 'delay_alert');
    sent = sendResult.ok;
  }

  await syncPostgresData(true);
  res.json({ ok: true, orderId, etaTimestamp: newEta, sentWhatsApp: sent, message: msg });
});

// Tickets create
app.post('/api/tickets/create', async (req, res) => {
  const { orderId, userPhone, description, category } = req.body;
  const cleanPhone = normalizePhone(userPhone || '');

  try {
    let userId = null;
    if (cleanPhone) {
      const uRes = await pgPool.query(
        `SELECT id FROM users WHERE phone LIKE '%' || $1 LIMIT 1`,
        [cleanPhone.slice(-10)]
      );
      if (uRes.rows.length > 0) userId = uRes.rows[0].id;
    }

    if (!userId) {
      const anyUser = await pgPool.query(`SELECT id FROM users LIMIT 1`);
      userId = anyUser.rows[0]?.id;
    }

    let ticketId = null;
    let isReopened = false;

    // If orderId is provided, check if a ticket already exists for this order -> continue old ticket!
    if (orderId) {
      const existing = await pgPool.query(
        `SELECT id, status FROM support_tickets WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId]
      );
      if (existing.rows.length > 0) {
        ticketId = existing.rows[0].id;
        isReopened = true;
        await pgPool.query(
          `UPDATE support_tickets SET status = 'OPEN'::ticket_status, updated_at = NOW() WHERE id = $1`,
          [ticketId]
        );
      }
    }

    if (!ticketId) {
      const subject = category ? `[${category}] Support Inquiry` : 'Support Inquiry';
      const insRes = await pgPool.query(
        `INSERT INTO support_tickets (user_id, order_id, subject, message, status) 
         VALUES ($1, $2, $3, $4, 'OPEN'::ticket_status) 
         RETURNING id::text`,
        [userId, orderId || null, subject, description || '']
      );
      ticketId = insRes.rows[0].id;
    }

    // Insert user message
    if (description) {
      await pgPool.query(
        `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
         VALUES ($1, 'USER', $2, 'Customer', $3, 'APP')`,
        [ticketId, userId || 'customer', description]
      );
    }

    // Automated bot prompt
    const botPrompt = isReopened
      ? "We've reopened your support request for this order. What seems to be the problem? Our support team will respond in a minute."
      : "Thanks for reaching out! What is the problem with your order? Our support team will respond in a minute.";

    await pgPool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
       VALUES ($1, 'BOT', 'buvva-assistant', 'Buvva Assistant', $2, 'APP')`,
      [ticketId, botPrompt]
    );

    if (cleanPhone && whatsappServiceStatus.ready) {
      await sendWhatsAppMessage(cleanPhone, `💬 *Buvva Support:*\n${botPrompt}`, 'support');
    }

    await syncPostgresData(true);
    res.json({ ok: true, ticketId, isReopened });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket resolve
app.post('/api/tickets/:ticketId/resolve', async (req, res) => {
  try {
    await pgPool.query(
      `UPDATE support_tickets SET status = 'RESOLVED'::ticket_status, updated_at = NOW() WHERE id = $1`,
      [req.params.ticketId]
    );

    const resolveNotice = "Your issue for this order has been marked as resolved. If you need any further assistance, feel free to reply here!";
    await pgPool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
       VALUES ($1, 'BOT', 'buvva-assistant', 'Buvva Assistant', $2, 'BOTH')`,
      [req.params.ticketId, resolveNotice]
    );

    const ticket = ticketsCache[req.params.ticketId];
    if (ticket && ticket.userPhone && whatsappServiceStatus.ready) {
      await sendWhatsAppMessage(ticket.userPhone, `✅ *Issue Resolved:*\n${resolveNotice}`, 'support');
    }

    await syncPostgresData(true);
    res.json({ ok: true, ticketId: req.params.ticketId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket reply
app.post('/api/tickets/:ticketId/reply', async (req, res) => {
  const { message, channel = 'BOTH' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const ticket = ticketsCache[req.params.ticketId];
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const upperChannel = String(channel).toUpperCase();
  let sentWhatsApp = false;

  if ((upperChannel === 'WHATSAPP' || upperChannel === 'BOTH') && ticket.userPhone && whatsappServiceStatus.ready) {
    const sendResult = await sendWhatsAppMessage(ticket.userPhone, `💬 *Staff Reply:*\n${message}`, 'support');
    sentWhatsApp = sendResult.ok;
  }

  try {
    const insRes = await pgPool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel) 
       VALUES ($1, 'AGENT', 'staff', 'Support Staff', $2, $3)
       RETURNING id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at`,
      [req.params.ticketId, message, upperChannel]
    );
    const newMsg = insRes.rows[0];

    await pgPool.query(
      `UPDATE support_tickets SET status = 'IN_PROGRESS'::ticket_status, updated_at = NOW() WHERE id = $1`,
      [req.params.ticketId]
    );

    io.to(`ticket:${req.params.ticketId}`).emit('ticket:message', newMsg);
    await syncPostgresData(true);
    res.json({ ok: true, sentWhatsApp, channel: upperChannel, message: newMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket messages
app.get('/api/tickets/:ticketId/messages', async (req, res) => {
  try {
    const ticketId = req.params.ticketId;
    const msgRes = await pgPool.query(
      `SELECT id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at 
       FROM support_messages 
       WHERE ticket_id = $1 
       ORDER BY created_at ASC`,
      [ticketId]
    );
    res.json({ ticketId, messages: msgRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buffering time
app.post('/api/buffering-time', async (req, res) => {
  const minutes = Number(req.body.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
    return res.status(400).json({ error: 'Buffering time must be between 1 and 180 minutes' });
  }

  botSettings.bufferingTimeMinutes = minutes;
  await saveBotSettings();
  emitSettings();
  res.json({ ok: true, minutes });
});

// ═══════════════════════════════════════════════════════════════════
//  Internal Webhooks from WhatsApp Microservice
// ═══════════════════════════════════════════════════════════════════

// WhatsApp microservice pushes incoming customer message or status
app.post('/api/internal/whatsapp/event', async (req, res) => {
  const { phone, contactName, body, type = 'text', status = 'received' } = req.body;
  if (!phone || !body) return res.status(400).json({ error: 'Missing phone or body' });

  const normalized = normalizePhone(phone);
  const logged = messageLog.add({
    direction: 'incoming',
    phone: normalized,
    contactName: contactName || '',
    body,
    type,
    status
  });
  emitNewMessage(logged);

  // Check if user has an active open ticket
  const activeTicket = Object.values(ticketsCache).find(t => 
    t.userPhone && normalizePhone(t.userPhone) === normalized && t.status !== 'Resolved'
  );

  let relayedToTicket = false;
  let ticketId = null;

  if (activeTicket) {
    ticketId = activeTicket.id;
    try {
      const ins = await pgPool.query(
        `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
         VALUES ($1, 'CUSTOMER', 'customer', $2, $3, 'WHATSAPP')
         RETURNING id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at`,
        [activeTicket.id, activeTicket.customerName || contactName || 'Customer', body]
      );
      await pgPool.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [activeTicket.id]);
      io.to(`ticket:${activeTicket.id}`).emit('ticket:message', ins.rows[0]);
      await syncPostgresData(true);
      relayedToTicket = true;
    } catch (err) {
      console.warn('[SupportServer] Failed to relay WhatsApp incoming message to ticket:', err.message);
    }
  }

  res.json({ ok: true, relayedToTicket, ticketId });
});

// WhatsApp microservice reports status updates (ready, qr, disconnected)
app.post('/api/internal/whatsapp/status', (req, res) => {
  const { ready, status, info } = req.body || {};
  whatsappServiceStatus = {
    ready: Boolean(ready),
    status: status || (ready ? 'ready' : 'connecting'),
    info: info || null,
    lastChecked: Date.now()
  };
  emitDashboard();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Socket.IO Real-time Events
// ═══════════════════════════════════════════════════════════════════

io.on('connection', socket => {
  socket.emit('dashboard:update', buildDashboardState());
  socket.emit('messages:init', messageLog.getAll());
  socket.emit('settings:update', botSettings);

  socket.on('ticket:join', async data => {
    const { ticketId } = data || {};
    if (!ticketId) return;
    socket.join(`ticket:${ticketId}`);
    try {
      const msgRes = await pgPool.query(
        `SELECT id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at 
         FROM support_messages 
         WHERE ticket_id = $1 
         ORDER BY created_at ASC`,
        [ticketId]
      );
      socket.emit('ticket:history', { ticketId, messages: msgRes.rows });
    } catch (err) {
      console.warn(`[SupportServer] Error loading history for ticket ${ticketId}:`, err.message);
    }
  });

  socket.on('ticket:leave', data => {
    const { ticketId } = data || {};
    if (ticketId) socket.leave(`ticket:${ticketId}`);
  });

  socket.on('ticket:send_message', async data => {
    const { ticketId, message, senderType = 'AGENT', senderName = 'Support Desk', channel = 'BOTH' } = data || {};
    if (!ticketId || !message) return;
    const upperChannel = String(channel).toUpperCase();

    try {
      const insRes = await pgPool.query(
        `INSERT INTO support_messages (ticket_id, sender_type, sender_id, sender_name, message, channel)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id::text, ticket_id::text, sender_type, sender_id, sender_name, message, channel, created_at`,
        [ticketId, senderType, senderType === 'AGENT' ? 'support_agent' : 'customer', senderName, message, upperChannel]
      );
      const newMsg = insRes.rows[0];

      await pgPool.query(
        `UPDATE support_tickets 
         SET status = CASE WHEN status = 'OPEN'::ticket_status THEN 'IN_PROGRESS'::ticket_status ELSE status END,
             updated_at = NOW() 
         WHERE id = $1`,
        [ticketId]
      );

      io.to(`ticket:${ticketId}`).emit('ticket:message', newMsg);

      if ((upperChannel === 'WHATSAPP' || upperChannel === 'BOTH') && senderType === 'AGENT') {
        const ticket = ticketsCache[ticketId];
        if (ticket && ticket.userPhone && whatsappServiceStatus.ready) {
          sendWhatsAppMessage(ticket.userPhone, `💬 *OnFood Support:*\n${message}`, 'support').catch(() => {});
        }
      }

      await syncPostgresData(true);
    } catch (err) {
      console.error('[SupportServer] Failed to process ticket:send_message:', err.message);
      socket.emit('ticket:error', { ticketId, error: err.message });
    }
  });

  socket.on('ticket:typing', data => {
    const { ticketId, senderName, isTyping } = data || {};
    if (ticketId) {
      socket.to(`ticket:${ticketId}`).emit('ticket:typing', { ticketId, senderName, isTyping });
    }
  });

  socket.on('ticket:status_change', async data => {
    const { ticketId, status } = data || {};
    if (!ticketId || !status) return;
    try {
      const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
      const upper = status.toUpperCase();
      if (!validStatuses.includes(upper)) return;

      await pgPool.query(
        `UPDATE support_tickets SET status = $1::ticket_status, updated_at = NOW() WHERE id = $2`,
        [upper, ticketId]
      );
      io.to(`ticket:${ticketId}`).emit('ticket:status_updated', { ticketId, status: upper });
      await syncPostgresData(true);
    } catch (err) {
      console.error('[SupportServer] Failed to change ticket status via WSS:', err.message);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Start Server
// ═══════════════════════════════════════════════════════════════════

function startServer() {
  startPostgresSync();
  checkWhatsAppHealth();

  server.listen(PORT, () => {
    console.log(`[SupportServer] OnFood Customer Support Command Center running at http://localhost:${PORT}`);
    console.log(`[SupportServer] WhatsApp Bridge target: ${WHATSAPP_SERVICE_URL}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer, pgPool };
