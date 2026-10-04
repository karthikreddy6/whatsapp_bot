// Order Status & Kitchen Dashboard Logic
const socket = io();

let state = null;
let currentSettings = null;

// DOM Elements
const whatsappStatus = document.getElementById('whatsappStatus');
const statusText = document.getElementById('statusText');
const activeOrdersEl = document.getElementById('activeOrders');
const recentOrdersEl = document.getElementById('recentOrders');
const openTicketsEl = document.getElementById('openTickets');
const avgDeliveryEl = document.getElementById('avgDelivery');
const lateOrdersEl = document.getElementById('lateOrders');
const ordersBody = document.getElementById('ordersBody');
const ticketsList = document.getElementById('ticketsList');
const statusFilter = document.getElementById('statusFilter');
const orderSearch = document.getElementById('orderSearch');
const quickBufferInput = document.getElementById('quickBufferInput');
const updateBufferBtn = document.getElementById('updateBufferBtn');
const dynamicBufferTip = document.getElementById('dynamicBufferTip');

// Settings Modal
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
const toastNotification = document.getElementById('toastNotification');

// Settings Form Inputs
const inputs = {
  minDelayMs: document.getElementById('minDelayMs'),
  maxDelayMs: document.getElementById('maxDelayMs'),
  perRecipientPerMinute: document.getElementById('perRecipientPerMinute'),
  globalPerMinute: document.getElementById('globalPerMinute'),
  typingEnabled: document.getElementById('typingEnabled'),
  readReceiptsEnabled: document.getElementById('readReceiptsEnabled'),
  responseDelayMinMs: document.getElementById('responseDelayMinMs'),
  responseDelayMaxMs: document.getElementById('responseDelayMaxMs'),
  typingSpeedCPM: document.getElementById('typingSpeedCPM'),
  messageVariety: document.getElementById('messageVariety'),
  backoffBaseMs: document.getElementById('backoffBaseMs'),
  backoffMultiplier: document.getElementById('backoffMultiplier'),
  backoffMaxMs: document.getElementById('backoffMaxMs'),
  bufferingTimeMinutes: document.getElementById('bufferingTimeMinutes')
};

// ═══════════════════════════════════════════════════════════════════
//  Socket Events
// ═══════════════════════════════════════════════════════════════════

socket.on('connect', () => {
  console.log('Connected to server via WebSocket');
});

socket.on('disconnect', () => {
  updateStatus(false, 'Disconnected');
});

socket.on('dashboard:update', nextState => {
  state = nextState;
  render();
});

socket.on('settings:update', settings => {
  currentSettings = settings;
  populateSettingsForm(settings);
  if (settings.bufferingTimeMinutes) {
    quickBufferInput.value = settings.bufferingTimeMinutes;
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Status Badge
// ═══════════════════════════════════════════════════════════════════

function updateStatus(isOnline, text) {
  if (isOnline) {
    whatsappStatus.className = 'status-badge online';
    statusText.textContent = text || 'Online & Ready';
  } else {
    whatsappStatus.className = 'status-badge';
    statusText.textContent = text || 'Connecting / QR';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Render Dashboard
// ═══════════════════════════════════════════════════════════════════

function render() {
  if (!state) return;
  updateStatus(state.whatsappReady, state.whatsappReady ? 'Online & Ready' : 'Connecting / QR');

  const m = state.metrics || {};
  activeOrdersEl.textContent = m.activeOrders || 0;
  recentOrdersEl.textContent = m.recentOrders || 0;
  openTicketsEl.textContent = m.openTickets || 0;
  avgDeliveryEl.textContent = `${m.avgDeliveryMinutes || 0}m`;
  lateOrdersEl.textContent = m.lateOrders || 0;

  if (document.activeElement !== quickBufferInput) {
    quickBufferInput.value = state.bufferingTimeMinutes || 20;
  }
  dynamicBufferTip.textContent = `Suggested: ${state.dynamicBuffer || 20}m based on kitchen load`;

  renderOrders();
  renderTickets();
}

statusFilter.addEventListener('change', renderOrders);
orderSearch.addEventListener('input', renderOrders);

function renderOrders() {
  if (!state || !state.orders) return;
  const filter = statusFilter.value;
  const query = (orderSearch.value || '').toLowerCase().trim();
  const now = Date.now();

  const orders = state.orders.filter(order => {
    if (filter && order.status !== filter) return false;
    if (query) {
      const matchId = order.id.toLowerCase().includes(query);
      const matchName = (order.username || '').toLowerCase().includes(query);
      const matchPhone = (order.userPhone || '').includes(query);
      return matchId || matchName || matchPhone;
    }
    return true;
  });

  if (!orders.length) {
    ordersBody.innerHTML = '<tr><td colspan="6" class="empty-state">No matching orders found.</td></tr>';
    return;
  }

  ordersBody.innerHTML = orders.map(order => {
    const isLate = order.etaTimestamp && order.etaTimestamp < now && !['Delivered', 'Cancelled'].includes(order.status);
    const itemsList = (order.items || []).map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join('<br>');
    const statusLower = (order.status || 'pending').toLowerCase().replace(/\s+/g, '');

    return `
      <tr>
        <td>
          <strong style="color: #fff; font-size: 0.95rem;">${escapeHtml(order.id)}</strong><br>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${formatTime(order.timestamp)}</span>
          ${order.isStuck ? '<br><span class="pill stuck">⚠️ Stuck 15m+</span>' : ''}
        </td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(order.username)}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(formatPhone(order.userPhone))}</div>
          <div style="font-size: 0.8rem; color: var(--primary); font-weight: 600;">₹${order.amount || 0}</div>
        </td>
        <td style="font-size: 0.85rem; color: #cbd5e1; max-width: 200px;">
          ${itemsList || '<span style="color: var(--text-muted);">No items</span>'}
        </td>
        <td>
          <span class="pill ${statusLower}">${escapeHtml(order.status)}</span>
        </td>
        <td>
          <div style="font-weight: 500;">${formatTime(order.etaTimestamp)}</div>
          ${isLate ? '<span class="pill late">Late</span>' : ''}
        </td>
        <td>
          <div class="action-btns">
            ${statusBtn(order.id, 'Preparing', order.status)}
            ${statusBtn(order.id, 'Cooking', order.status)}
            ${statusBtn(order.id, 'Ready for Pickup', order.status)}
            ${statusBtn(order.id, 'Delivered', order.status)}
            <button class="btn-small" onclick="promptEta('${escapeHtml(order.id)}')">⏱️ ETA</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function statusBtn(orderId, targetStatus, currentStatus) {
  const isCurrent = targetStatus === currentStatus;
  const style = isCurrent ? 'background: var(--primary); border-color: var(--primary); font-weight: 700;' : '';
  return `
    <button class="btn-small" style="${style}" onclick="updateOrderStatus('${escapeHtml(orderId)}', '${targetStatus}')">
      ${targetStatus === 'Ready for Pickup' ? 'Ready' : targetStatus}
    </button>
  `;
}

function renderTickets() {
  if (!state || !state.tickets) return;
  const tickets = state.tickets;

  if (!tickets.length) {
    ticketsList.innerHTML = '<div class="empty-state">No support tickets.</div>';
    return;
  }

  ticketsList.innerHTML = tickets.map(ticket => {
    const isResolved = ticket.status === 'Resolved';
    const isReplied = ticket.status === 'Replied';
    const pillClass = isResolved ? 'ready' : isReplied ? 'preparing' : 'pending';

    return `
      <div class="ticket-item">
        <div class="ticket-header">
          <span class="ticket-order">Order #${escapeHtml(ticket.orderId)}</span>
          <span class="pill ${pillClass}">${escapeHtml(ticket.status)}</span>
        </div>
        <div class="ticket-desc">${escapeHtml(ticket.description || 'No description')}</div>
        ${ticket.lastReply ? `<div style="font-size: 0.75rem; color: #6ee7b7;">Staff reply: ${escapeHtml(ticket.lastReply)}</div>` : ''}
        <div class="ticket-actions">
          ${!isResolved ? `<button class="btn-small" onclick="resolveTicket('${escapeHtml(ticket.id)}')">Resolve</button>` : ''}
          <button class="btn-small" onclick="replyTicket('${escapeHtml(ticket.id)}')">Reply WhatsApp</button>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  Order Actions
// ═══════════════════════════════════════════════════════════════════

window.updateOrderStatus = async function(orderId, status) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      showToast(`Order status updated to ${status}`);
    } else {
      showToast('Failed to update status');
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

window.promptEta = async function(orderId) {
  const value = window.prompt('Set ETA in minutes from now (e.g. 15):', '15');
  if (!value) return;
  const minutes = Number(value);
  if (isNaN(minutes) || minutes < 1 || minutes > 180) {
    alert('Please enter a valid number of minutes between 1 and 180.');
    return;
  }

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/eta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    });
    if (res.ok) {
      showToast(`ETA updated (+${minutes}m)`);
    } else {
      showToast('Failed to set ETA');
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

window.resolveTicket = async function(ticketId) {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      showToast('Ticket marked as resolved');
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

window.replyTicket = async function(ticketId) {
  const message = window.prompt('Type response message to send to customer via WhatsApp:');
  if (!message || !message.trim()) return;

  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() })
    });
    if (res.ok) {
      showToast('Reply dispatched with human delays & rate limiting');
    } else {
      showToast('Failed to send reply');
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  Quick Buffer Time
// ═══════════════════════════════════════════════════════════════════

updateBufferBtn.addEventListener('click', async () => {
  const minutes = Number(quickBufferInput.value);
  if (isNaN(minutes) || minutes < 1 || minutes > 180) {
    alert('Please enter buffer minutes between 1 and 180');
    return;
  }

  try {
    const res = await fetch('/api/buffering-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    });
    if (res.ok) {
      showToast(`Default preparation buffer updated to ${minutes}m`);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Settings Modal & Customization
// ═══════════════════════════════════════════════════════════════════

openSettingsBtn.addEventListener('click', async () => {
  if (!currentSettings) {
    try {
      const res = await fetch('/api/settings');
      currentSettings = await res.json();
    } catch (e) {}
  }
  populateSettingsForm(currentSettings);
  settingsModal.classList.add('open');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('open');
});

settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('open');
  }
});

function populateSettingsForm(s) {
  if (!s) return;
  const rl = s.rateLimits || {};
  const hb = s.humanBehavior || {};
  const eh = s.errorHandling || {};

  inputs.minDelayMs.value = rl.minDelayMs || 2000;
  inputs.maxDelayMs.value = rl.maxDelayMs || 8000;
  inputs.perRecipientPerMinute.value = rl.perRecipientPerMinute || 3;
  inputs.globalPerMinute.value = rl.globalPerMinute || 20;

  inputs.typingEnabled.checked = hb.typingEnabled !== false;
  inputs.readReceiptsEnabled.checked = hb.readReceiptsEnabled !== false;
  inputs.responseDelayMinMs.value = hb.responseDelayMinMs || 1500;
  inputs.responseDelayMaxMs.value = hb.responseDelayMaxMs || 5000;
  inputs.typingSpeedCPM.value = hb.typingSpeedCPM || 280;

  inputs.messageVariety.checked = s.messageVariety !== false;

  inputs.backoffBaseMs.value = eh.backoffBaseMs || 5000;
  inputs.backoffMultiplier.value = eh.backoffMultiplier || 2;
  inputs.backoffMaxMs.value = eh.backoffMaxMs || 300000;

  inputs.bufferingTimeMinutes.value = s.bufferingTimeMinutes || 20;
}

saveSettingsBtn.addEventListener('click', async () => {
  const payload = {
    rateLimits: {
      minDelayMs: Number(inputs.minDelayMs.value),
      maxDelayMs: Number(inputs.maxDelayMs.value),
      perRecipientPerMinute: Number(inputs.perRecipientPerMinute.value),
      globalPerMinute: Number(inputs.globalPerMinute.value)
    },
    humanBehavior: {
      typingEnabled: inputs.typingEnabled.checked,
      readReceiptsEnabled: inputs.readReceiptsEnabled.checked,
      responseDelayMinMs: Number(inputs.responseDelayMinMs.value),
      responseDelayMaxMs: Number(inputs.responseDelayMaxMs.value),
      typingSpeedCPM: Number(inputs.typingSpeedCPM.value)
    },
    messageVariety: inputs.messageVariety.checked,
    errorHandling: {
      backoffBaseMs: Number(inputs.backoffBaseMs.value),
      backoffMultiplier: Number(inputs.backoffMultiplier.value),
      backoffMaxMs: Number(inputs.backoffMaxMs.value)
    },
    bufferingTimeMinutes: Number(inputs.bufferingTimeMinutes.value)
  };

  saveSettingsBtn.disabled = true;
  saveSettingsBtn.textContent = 'Saving...';

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Settings saved successfully!');
      settingsModal.classList.remove('open');
    } else {
      showToast('Error saving settings');
    }
  } catch (err) {
    showToast('Failed to save: ' + err.message);
  } finally {
    saveSettingsBtn.disabled = false;
    saveSettingsBtn.textContent = 'Save Changes';
  }
});

resetDefaultsBtn.addEventListener('click', async () => {
  if (!confirm('Reset all rate limits and bot settings to defaults?')) return;
  try {
    const res = await fetch('/api/settings/reset', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      populateSettingsForm(data.settings);
      showToast('Settings reset to defaults');
    }
  } catch (e) {
    showToast('Failed to reset: ' + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function showToast(msg) {
  toastNotification.textContent = msg;
  toastNotification.classList.add('show');
  setTimeout(() => toastNotification.classList.remove('show'), 3500);
}

function formatPhone(phone) {
  const p = String(phone || '');
  if (p.length === 12 && p.startsWith('91')) {
    return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  }
  return p;
}

function formatTime(timestamp) {
  if (!timestamp) return 'Not set';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(timestamp));
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial fetch if socket not yet connected
fetch('/api/summary')
  .then(res => res.json())
  .then(data => {
    if (data && !state) {
      state = data;
      render();
    }
  })
  .catch(() => {});
