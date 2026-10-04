const path = require('path');
const fs = require('fs');

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const DEFAULT_SETTINGS = {
  rateLimits: {
    perRecipientPerMinute: 3,
    globalPerMinute: 20,
    minDelayMs: 2000,
    maxDelayMs: 8000,
  },
  humanBehavior: {
    typingEnabled: true,
    readReceiptsEnabled: true,
    responseDelayMinMs: 1500,
    responseDelayMaxMs: 5000,
    typingSpeedCPM: 280,
  },
  errorHandling: {
    backoffBaseMs: 5000,
    backoffMaxMs: 300000,
    backoffMultiplier: 2,
  },
  bufferingTimeMinutes: 20,
  messageVariety: true,
  botRelay: {
    enabled: true,
    mode: 'hybrid',
    autoReplyDelaySec: 2,
    relayToHumanOnTicket: true,
    customGreeting: 'Hello! Welcome to OnFood Support Desk. How can we assist you today?',
    customHelpMenu: '*OnFood Problem Report*\nWhat is the issue? Reply with the number:\n1️⃣ Order is late\n2️⃣ Missing item\n3️⃣ Food quality issue\n4️⃣ Talk to human support staff',
    customDelayApology: 'We sincerely apologize for the delay. Our chefs are expediting your meal right now!',
    customReadyMessage: 'Your order is freshly prepared and ready for pickup at the counter! 🍽️'
  }
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeSettings(target, source) {
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      mergeSettings(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const STATUS_FLOW = ['Pending', 'Preparing', 'Cooking', 'Ready for Pickup', 'Delivered'];

const DB_TO_UI_STATUS = {
  'PLACED': 'Pending',
  'SCHEDULED': 'Scheduled',
  'PREPARING': 'Preparing',
  'READY_FOR_PICKUP': 'Ready for Pickup',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
  'REJECTED': 'Cancelled'
};

const UI_TO_DB_STATUS = {
  'pending': 'PLACED',
  'placed': 'PLACED',
  'scheduled': 'SCHEDULED',
  'preparing': 'PREPARING',
  'cooking': 'PREPARING',
  'ready': 'READY_FOR_PICKUP',
  'ready for pickup': 'READY_FOR_PICKUP',
  'delivered': 'DELIVERED',
  'completed': 'DELIVERED',
  'cancelled': 'CANCELLED',
  'rejected': 'REJECTED'
};

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

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function normalizeStatus(status) {
  if (!status) return null;
  return STATUS_ALIASES[String(status).trim().toLowerCase()] || null;
}

const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

function normalizeOrder(id, order = {}, bufferingMinutes = 20) {
  const timestamp = Number(order.timestamp || order.createdAt || (order.created_at ? new Date(order.created_at).getTime() : 0));
  const updatedAt = Number(order.updatedAt || (order.updated_at ? new Date(order.updated_at).getTime() : timestamp));
  const etaTimestamp = Number(order.etaTimestamp || (order.estimated_ready_at ? new Date(order.estimated_ready_at).getTime() : timestamp + bufferingMinutes * 60 * 1000));
  
  const rawItems = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
  const items = rawItems.map(item => ({
    name: item.name || item.item_name || 'Item',
    quantity: Number(item.quantity || 1),
    price: Number(item.price || item.unit_price || 0)
  }));

  const uiStatus = DB_TO_UI_STATUS[order.status] || normalizeStatus(order.status) || order.status || 'Pending';
  const isStuck = !['Delivered', 'Cancelled'].includes(uiStatus) && (Date.now() - updatedAt > STUCK_THRESHOLD_MS);

  return {
    id: String(id),
    userId: order.userId || order.user_id || '',
    username: order.username || order.name || 'Customer',
    userPhone: order.userPhone || order.user_phone || order.phone || '',
    amount: Number(order.amount || order.total_amount || 0),
    status: uiStatus,
    timestamp,
    etaTimestamp,
    updatedAt,
    isStuck,
    readyAt: Number(order.readyAt || (order.actual_ready_at ? new Date(order.actual_ready_at).getTime() : 0)),
    deliveredAt: Number(order.deliveredAt || 0),
    orderDate: order.orderDate || '',
    orderTime: order.orderTime || '',
    orderToken: order.orderToken || order.order_token || '',
    pickupNumber: order.pickupNumber || order.pickup_number || '',
    items
  };
}

function normalizeTicket(id, ticket = {}) {
  return {
    id: String(id),
    orderId: ticket.orderId || ticket.order_id || id,
    userId: ticket.userId || ticket.user_id || '',
    userPhone: ticket.userPhone || ticket.user_phone || '',
    customerName: ticket.customerName || ticket.customer_name || 'Customer',
    description: ticket.description || ticket.message || ticket.subject || '',
    status: ticket.status || 'Open',
    lastReply: ticket.lastReply || ticket.last_reply || '',
    timestamp: Number(ticket.timestamp || (ticket.created_at ? new Date(ticket.created_at).getTime() : 0)),
    updatedAt: Number(ticket.updatedAt || (ticket.updated_at ? new Date(ticket.updated_at).getTime() : 0))
  };
}

function formatTime(timestamp) {
  if (!timestamp) return 'not set';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(timestamp));
}

function extractOrderId(text) {
  if (!text) return null;
  const uuidMatch = text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch) return uuidMatch[0];
  const legacyMatch = text.match(/[A-Za-z]{4}\d{8}/);
  if (legacyMatch) return legacyMatch[0].toUpperCase();
  const hexMatch = text.match(/[0-9a-fA-F]{8}/);
  if (hexMatch) return hexMatch[0].toLowerCase();
  return null;
}

module.exports = {
  loadLocalEnvironment,
  DEFAULT_SETTINGS,
  deepClone,
  mergeSettings,
  STATUS_FLOW,
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
};
