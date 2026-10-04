// OnFood Customer Support Command Center Logic
const socket = io();

let state = null;
let currentSettings = null;
let allMessages = [];
let selectedContactPhone = null;
let activeStatusFilter = '';
let activeTicketFilter = 'all';

// Charts instances
let pipelineChart = null;
let hourlyChart = null;
let slaChart = null;

// DOM Elements
const wsStatus = document.getElementById('wsStatus');
const wsStatusText = document.getElementById('wsStatusText');
const whatsappStatus = document.getElementById('whatsappStatus');
const statusText = document.getElementById('statusText');
const toastNotification = document.getElementById('toastNotification');

// KPI Elements
const kpiTodayOrders = document.getElementById('kpiTodayOrders');
const kpiTodayRevenue = document.getElementById('kpiTodayRevenue');
const kpiTotalOrders = document.getElementById('kpiTotalOrders');
const kpiActiveOrders = document.getElementById('kpiActiveOrders');
const kpiActiveBreakdown = document.getElementById('kpiActiveBreakdown');
const kpiDelayedOrders = document.getElementById('kpiDelayedOrders');
const kpiDelayedSubtext = document.getElementById('kpiDelayedSubtext');
const kpiDelayCard = document.getElementById('kpiDelayCard');
const kpiOpenTickets = document.getElementById('kpiOpenTickets');
const kpiRepliedTickets = document.getElementById('kpiRepliedTickets');
const kpiResolvedTickets = document.getElementById('kpiResolvedTickets');
const kpiAvgDelivery = document.getElementById('kpiAvgDelivery');
const kpiBufferTime = document.getElementById('kpiBufferTime');
const kpiDynamicBuffer = document.getElementById('kpiDynamicBuffer');

// Delayed Orders Alert Banner
const priorityDelaySection = document.getElementById('priorityDelaySection');
const priorityDelayGrid = document.getElementById('priorityDelayGrid');
const priorityDelayCount = document.getElementById('priorityDelayCount');
const jumpDelayedBtn = document.getElementById('jumpDelayedBtn');
const delayedHeaderCount = document.getElementById('delayedHeaderCount');
const tabDelayedFilter = document.getElementById('tabDelayedFilter');
const tabDelayedCount = document.getElementById('tabDelayedCount');

// Orders Table & Filter
const ordersBody = document.getElementById('ordersBody');
const orderSearch = document.getElementById('orderSearch');
const filterTabs = document.getElementById('filterTabs');

// Tickets Panel
const ticketsList = document.getElementById('ticketsList');
const ticketFilterAll = document.getElementById('ticketFilterAll');
const ticketFilterOpen = document.getElementById('ticketFilterOpen');
const ticketFilterResolved = document.getElementById('ticketFilterResolved');

// WhatsApp Drawer
const whatsappDrawer = document.getElementById('whatsappDrawer');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');
const floatingDrawerTrigger = document.getElementById('floatingDrawerTrigger');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerUnreadBadge = document.getElementById('drawerUnreadBadge');
const floatingUnreadBadge = document.getElementById('floatingUnreadBadge');
const drawerContactSearch = document.getElementById('drawerContactSearch');
const drawerContactsList = document.getElementById('drawerContactsList');
const drawerMessagesStream = document.getElementById('drawerMessagesStream');
const activeChatName = document.getElementById('activeChatName');
const activeChatPhone = document.getElementById('activeChatPhone');
const drawerClearFilterBtn = document.getElementById('drawerClearFilterBtn');
const drawerTargetPhone = document.getElementById('drawerTargetPhone');
const drawerMessageText = document.getElementById('drawerMessageText');
const drawerSendBtn = document.getElementById('drawerSendBtn');

// Modals
const newTicketModal = document.getElementById('newTicketModal');
const openNewTicketBtn = document.getElementById('openNewTicketBtn');
const quickNewTicketBtn = document.getElementById('quickNewTicketBtn');
const closeNewTicketBtn = document.getElementById('closeNewTicketBtn');
const cancelNewTicketBtn = document.getElementById('cancelNewTicketBtn');
const submitNewTicketBtn = document.getElementById('submitNewTicketBtn');

const delayAlertModal = document.getElementById('delayAlertModal');
const closeDelayAlertBtn = document.getElementById('closeDelayAlertBtn');
const cancelDelayAlertBtn = document.getElementById('cancelDelayAlertBtn');
const submitDelayAlertBtn = document.getElementById('submitDelayAlertBtn');
const delayModalOrderId = document.getElementById('delayModalOrderId');
const delayModalCustomer = document.getElementById('delayModalCustomer');
const delayModalMinutes = document.getElementById('delayModalMinutes');
const delayModalMessage = document.getElementById('delayModalMessage');

const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');

const settingsInputs = {
  minDelayMs: document.getElementById('minDelayMs'),
  maxDelayMs: document.getElementById('maxDelayMs'),
  perRecipientPerMinute: document.getElementById('perRecipientPerMinute'),
  globalPerMinute: document.getElementById('globalPerMinute'),
  typingEnabled: document.getElementById('typingEnabled'),
  readReceiptsEnabled: document.getElementById('readReceiptsEnabled'),
  responseDelayMinMs: document.getElementById('responseDelayMinMs'),
  responseDelayMaxMs: document.getElementById('responseDelayMaxMs'),
  typingSpeedCPM: document.getElementById('typingSpeedCPM'),
  bufferingTimeMinutes: document.getElementById('bufferingTimeMinutes'),
  // Bot Relay Customization
  botRelayEnabled: document.getElementById('botRelayEnabled'),
  botRelayMode: document.getElementById('botRelayMode'),
  relayToHumanOnTicket: document.getElementById('relayToHumanOnTicket'),
  autoReplyDelaySec: document.getElementById('autoReplyDelaySec'),
  customGreeting: document.getElementById('customGreeting'),
  customHelpMenu: document.getElementById('customHelpMenu'),
  customDelayApology: document.getElementById('customDelayApology'),
  customReadyMessage: document.getElementById('customReadyMessage')
};

// Ticket Chat Modal Elements
let activeTicketChatId = null;
let ticketTypingTimeout = null;
let selectedReplyChannel = 'BOTH'; // Default: Multi-channel (In-App Chat + WhatsApp)
let knownTicketIds = new Set();
let isFirstDashboardLoad = true;

const ticketChatModal = document.getElementById('ticketChatModal');
const closeTicketChatBtn = document.getElementById('closeTicketChatBtn');
const ticketChatTitle = document.getElementById('ticketChatTitle');
const ticketChatSubtitle = document.getElementById('ticketChatSubtitle');
const ticketChatStatusSelect = document.getElementById('ticketChatStatusSelect');
const ticketChatOrderBar = document.getElementById('ticketChatOrderBar');
const ticketChatOrderDetails = document.getElementById('ticketChatOrderDetails');
const ticketChatOrderActions = document.getElementById('ticketChatOrderActions');
const ticketCallCustomerBtn = document.getElementById('ticketCallCustomerBtn');
const ticketSmsCustomerBtn = document.getElementById('ticketSmsCustomerBtn');
const ticketChatStream = document.getElementById('ticketChatStream');
const ticketTypingIndicator = document.getElementById('ticketTypingIndicator');
const ticketChatInput = document.getElementById('ticketChatInput');
const ticketChatSendBtn = document.getElementById('ticketChatSendBtn');
const ticketChatBumpBtn = document.getElementById('ticketChatBumpBtn');
const channelHintText = document.getElementById('channelHintText');
const drawerChannelSelect = document.getElementById('drawerChannelSelect');

function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
//  WebSocket Listeners
// ═══════════════════════════════════════════════════════════════════

socket.on('connect', () => {
  wsStatus.className = 'status-badge online';
  wsStatusText.textContent = 'WS Live';
});

socket.on('disconnect', () => {
  wsStatus.className = 'status-badge';
  wsStatusText.textContent = 'WS Offline';
});

socket.on('dashboard:update', nextState => {
  const currentTickets = (nextState && nextState.tickets) || [];
  
  if (!isFirstDashboardLoad) {
    const newOpenTickets = currentTickets.filter(t => t.status !== 'Resolved' && !knownTicketIds.has(String(t.id)));
    if (newOpenTickets.length > 0) {
      const t = newOpenTickets[0];
      playNotificationChime();
      showToast(`🚨 New Ticket Raised: ${t.customerName || 'Customer'} (#${t.orderId || t.id}) — ${t.description || 'Assistance requested'}`);
    }
  }

  knownTicketIds = new Set(currentTickets.map(t => String(t.id)));
  isFirstDashboardLoad = false;
  state = nextState;
  renderDashboard();
});

socket.on('ticket:history', data => {
  if (data && String(data.ticketId) === String(activeTicketChatId)) {
    renderTicketChatMessages(data.messages || []);
  }
});

socket.on('ticket:message', msg => {
  if (msg && String(msg.ticket_id) === String(activeTicketChatId)) {
    appendTicketChatMessage(msg);
  } else if (msg) {
    if (msg.sender_type === 'CUSTOMER') {
      playNotificationChime();
      showToast(`💬 Customer Message on Ticket #${msg.ticket_id}: "${(msg.message || '').substring(0, 40)}..."`);
    } else {
      showToast(`Sent response on Ticket #${msg.ticket_id}`);
    }
  }
});

socket.on('ticket:typing', data => {
  if (data && String(data.ticketId) === String(activeTicketChatId) && ticketTypingIndicator) {
    if (data.isTyping) {
      ticketTypingIndicator.style.display = 'block';
      ticketTypingIndicator.innerHTML = `<span class="typing-dots">•••</span> ${escapeHtml(data.senderName || 'Customer')} is typing...`;
    } else {
      ticketTypingIndicator.style.display = 'none';
    }
  }
});

socket.on('ticket:status_updated', data => {
  if (data && String(data.ticketId) === String(activeTicketChatId) && ticketChatStatusSelect) {
    ticketChatStatusSelect.value = data.status;
    showToast(`Ticket #${data.ticketId} marked ${data.status}`);
  }
});

socket.on('messages:init', msgs => {
  allMessages = msgs || [];
  renderDrawerContacts();
  renderDrawerMessages();
  updateUnreadCount();
});

socket.on('messages:new', msg => {
  allMessages.push(msg);
  renderDrawerContacts();
  renderDrawerMessages();
  updateUnreadCount();
  if (msg.direction === 'incoming') {
    showToast(`💬 New WhatsApp message from ${msg.contactName || msg.phone}`);
  }
});

socket.on('settings:update', settings => {
  currentSettings = settings;
  populateSettingsForm(settings);
  if (settings.bufferingTimeMinutes && kpiBufferTime) {
    kpiBufferTime.textContent = `${settings.bufferingTimeMinutes}m`;
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Render Dashboard
// ═══════════════════════════════════════════════════════════════════

function renderDashboard() {
  if (!state) return;

  // WhatsApp Status
  updateWhatsAppStatus(state.whatsappReady, state.whatsappStatus);

  const m = state.metrics || {};
  const orders = state.orders || [];
  const delayedOrders = state.delayedOrders || [];
  const tickets = state.tickets || [];

  // KPIs
  kpiTodayOrders.textContent = m.todayOrdersCount || (m.recentOrders || 0);
  kpiTodayRevenue.textContent = `₹${(m.todayRevenue || 0).toLocaleString()}`;
  kpiTotalOrders.textContent = m.totalOrdersCount || orders.length;

  kpiActiveOrders.textContent = m.activeOrders || 0;
  const counts = state.statusCounts || {};
  kpiActiveBreakdown.innerHTML = `
    <span>Pnd: <b>${counts.Pending || 0}</b></span> •
    <span>Prep: <b>${counts.Preparing || 0}</b></span> •
    <span>Cook: <b>${counts.Cooking || 0}</b></span> •
    <span>Rdy: <b>${counts['Ready for Pickup'] || 0}</b></span>
  `;

  // Delayed Orders KPI & Alerts
  const delayCount = delayedOrders.length;
  kpiDelayedOrders.textContent = delayCount;
  delayedHeaderCount.textContent = delayCount;
  tabDelayedCount.textContent = delayCount;

  if (delayCount > 0) {
    kpiDelayCard.classList.add('delayed-alert');
    kpiDelayedSubtext.innerHTML = `<b style="color: #ef4444;">${delayCount} orders late</b> — click to inspect`;
    jumpDelayedBtn.style.display = 'inline-flex';
    priorityDelaySection.style.display = 'block';
    priorityDelayCount.textContent = delayCount;
    renderPriorityDelayCards(delayedOrders);
  } else {
    kpiDelayCard.classList.remove('delayed-alert');
    kpiDelayedSubtext.textContent = 'All orders running on-time';
    jumpDelayedBtn.style.display = 'none';
    priorityDelaySection.style.display = 'none';
  }

  // Tickets KPI
  kpiOpenTickets.textContent = m.openTickets || 0;
  kpiRepliedTickets.textContent = m.repliedTickets || 0;
  kpiResolvedTickets.textContent = m.resolvedTickets || 0;

  // Fulfillment KPI
  kpiAvgDelivery.textContent = `${m.avgDeliveryMinutes || 0}m`;
  kpiBufferTime.textContent = `${state.bufferingTimeMinutes || 20}m`;
  kpiDynamicBuffer.textContent = `${state.dynamicBuffer || 20}m`;

  // Render Charts
  renderCharts();

  // Render Orders & Tickets
  renderOrdersTable();
  renderTicketsList();
}

function updateWhatsAppStatus(isReady, status) {
  if (isReady) {
    whatsappStatus.className = 'status-badge online';
    statusText.textContent = 'WhatsApp Ready';
  } else if (status === 'qr_required') {
    whatsappStatus.className = 'status-badge';
    whatsappStatus.style.background = '#f59e0b';
    statusText.textContent = 'Scan QR Code';
  } else if (status === 'offline') {
    whatsappStatus.className = 'status-badge';
    whatsappStatus.style.background = '#6b7280';
    statusText.textContent = 'WhatsApp Standby';
  } else {
    whatsappStatus.className = 'status-badge';
    whatsappStatus.style.background = '';
    statusText.textContent = 'Connecting / Standby';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  WS Live Support Charts (Chart.js with SVG fallback)
// ═══════════════════════════════════════════════════════════════════

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const counts = state.statusCounts || {
    Pending: 0,
    Preparing: 0,
    Cooking: 0,
    'Ready for Pickup': 0,
    Delivered: 0,
    Cancelled: 0
  };

  // 1. Pipeline Donut Chart
  const pipelineCanvas = document.getElementById('pipelineChart');
  if (pipelineCanvas) {
    const pipelineData = [
      counts.Pending || 0,
      counts.Preparing || 0,
      counts.Cooking || 0,
      counts['Ready for Pickup'] || 0,
      counts.Delivered || 0,
      counts.Cancelled || 0
    ];

    if (!pipelineChart) {
      pipelineChart = new Chart(pipelineCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Pending', 'Preparing', 'Cooking', 'Ready', 'Delivered', 'Cancelled'],
          datasets: [{
            data: pipelineData,
            backgroundColor: ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#64748b', '#ef4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#94a3b8', font: { size: 10 } }
            }
          },
          cutout: '70%'
        }
      });
    } else {
      pipelineChart.data.datasets[0].data = pipelineData;
      pipelineChart.update();
    }
  }

  // 2. Hourly Influx Chart
  const hourlyCanvas = document.getElementById('hourlyChart');
  if (hourlyCanvas && state.hourlyActivity) {
    const hourly = state.hourlyActivity;
    // Current hour window: show 6:00 to 23:00
    const labels = hourly.labels.slice(6, 23);
    let orderCounts = hourly.orders.slice(6, 23);
    let ticketCounts = hourly.tickets.slice(6, 23);

    // If today is empty yet, plot the overall order activity by hour as pattern
    if (orderCounts.every(v => v === 0) && state.orders && state.orders.length > 0) {
      const fallbackHours = Array(24).fill(0);
      state.orders.forEach(o => {
        if (o.timestamp) {
          const h = new Date(o.timestamp).getHours();
          fallbackHours[h]++;
        }
      });
      orderCounts = fallbackHours.slice(6, 23);
    }

    if (!hourlyChart) {
      hourlyChart = new Chart(hourlyCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Orders Influx',
              data: orderCounts,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              tension: 0.35,
              fill: true,
              pointRadius: 3
            },
            {
              label: 'Support Tickets',
              data: ticketCounts,
              borderColor: '#f59e0b',
              backgroundColor: 'transparent',
              tension: 0.35,
              pointRadius: 2,
              borderDash: [4, 4]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#94a3b8', font: { size: 10 } }
            }
          },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { display: false } },
            y: { ticks: { color: '#64748b', stepSize: 1 }, grid: { color: '#1e293b' }, beginAtZero: true }
          }
        }
      });
    } else {
      hourlyChart.data.datasets[0].data = orderCounts;
      hourlyChart.data.datasets[1].data = ticketCounts;
      hourlyChart.update();
    }
  }

  // 3. SLA & Delay Performance Gauge
  const slaCanvas = document.getElementById('slaChart');
  if (slaCanvas) {
    const totalActive = (state.metrics && state.metrics.activeOrders) || 0;
    const delayedCount = (state.metrics && state.metrics.delayedOrdersCount) || 0;
    const onTimeCount = Math.max(0, totalActive - delayedCount);
    const onTimePct = totalActive > 0 ? Math.round((onTimeCount / totalActive) * 100) : 100;

    const slaBadge = document.getElementById('slaRateBadge');
    if (slaBadge) {
      slaBadge.textContent = `${onTimePct}% On-Time`;
      slaBadge.style.color = onTimePct >= 85 ? '#10b981' : (onTimePct >= 65 ? '#f59e0b' : '#ef4444');
    }

    if (!slaChart) {
      slaChart = new Chart(slaCanvas, {
        type: 'doughnut',
        data: {
          labels: ['On-Time', 'Delayed'],
          datasets: [{
            data: [Math.max(1, onTimeCount), delayedCount],
            backgroundColor: ['#10b981', '#ef4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          circumference: 180,
          rotation: -90,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', font: { size: 10 } }
            }
          },
          cutout: '75%'
        }
      });
    } else {
      slaChart.data.datasets[0].data = [Math.max(1, onTimeCount), delayedCount];
      slaChart.update();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Render Flagged Delay Orders Alert Banner
// ═══════════════════════════════════════════════════════════════════

function renderPriorityDelayCards(delayedOrders) {
  if (!priorityDelayGrid) return;
  priorityDelayGrid.innerHTML = '';

  delayedOrders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'delayed-order-card';

    const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'No item details';
    const urgencyClass = order.delayMinutes >= 20 ? '#ef4444' : '#f59e0b';

    card.innerHTML = `
      <div class="delayed-order-header">
        <div>
          <strong style="color: #fff; font-size: 0.95rem;">${order.id}</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">${order.username || 'Customer'}</span>
        </div>
        <span class="delay-badge" style="border-color: ${urgencyClass}; color: ${urgencyClass};">
          🚨 +${order.delayMinutes}m late
        </span>
      </div>
      <div style="font-size: 0.8rem; color: #cbd5e1;">
        Status: <b style="color: #f8fafc;">${order.status}</b> | Phone: 
        <span class="customer-link" onclick="openDrawerWithCustomer('${order.userPhone}', '${escapeHtml(order.username)}')">${order.userPhone || 'N/A'}</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        Items: ${escapeHtml(itemsSummary)}
      </div>
      <div class="delayed-order-actions">
        <button class="btn-bump btn-bump-alert" onclick="openDelayModal('${order.id}', '${order.userPhone}', '${escapeHtml(order.username)}')">
          📢 WhatsApp Delay Notice
        </button>
        <button class="btn-bump btn-bump-primary" onclick="quickBumpEta('${order.id}', 10)">
          +10m ETA
        </button>
        <button class="btn-bump" onclick="updateOrderStatus('${order.id}', 'Ready for Pickup')">
          Mark Ready
        </button>
        <button class="btn-bump" onclick="openDrawerWithCustomer('${order.userPhone}', '${escapeHtml(order.username)}')">
          💬 Chat
        </button>
      </div>
    `;
    priorityDelayGrid.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Render Orders Table
// ═══════════════════════════════════════════════════════════════════

function renderOrdersTable() {
  if (!state || !ordersBody) return;

  const query = (orderSearch.value || '').trim().toLowerCase();
  let orders = state.orders || [];

  // Filter by status tab
  if (activeStatusFilter === 'DELAYED') {
    orders = state.delayedOrders || [];
  } else if (activeStatusFilter) {
    orders = orders.filter(o => o.status === activeStatusFilter);
  }

  // Filter by search query
  if (query) {
    orders = orders.filter(o =>
      (o.id && o.id.toLowerCase().includes(query)) ||
      (o.username && o.username.toLowerCase().includes(query)) ||
      (o.userPhone && o.userPhone.includes(query))
    );
  }

  if (orders.length === 0) {
    ordersBody.innerHTML = `<tr><td colspan="6" class="empty-state">No matching orders found.</td></tr>`;
    return;
  }

  ordersBody.innerHTML = '';

  orders.slice(0, 100).forEach(order => {
    const tr = document.createElement('tr');

    const isLate = order.etaTimestamp && order.etaTimestamp < Date.now() && !['Delivered', 'Cancelled'].includes(order.status);
    if (isLate || order.isStuck) {
      tr.style.background = 'rgba(239, 68, 68, 0.05)';
    }

    const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Item';
    const etaFormatted = order.etaTimestamp ? formatTime(order.etaTimestamp) : 'Not set';

    let etaDisplay = etaFormatted;
    if (isLate) {
      const delayMin = Math.max(1, Math.round((Date.now() - order.etaTimestamp) / 60000));
      etaDisplay = `<span style="color: #ef4444; font-weight: 700;">${etaFormatted} (+${delayMin}m)</span>`;
    }

    tr.innerHTML = `
      <td>
        <strong style="color: #fff;">${order.id}</strong>
        <div style="font-size: 0.72rem; color: var(--text-muted);">${formatTime(order.timestamp)}</div>
      </td>
      <td>
        <div>${escapeHtml(order.username || 'Customer')}</div>
        <div class="customer-link" onclick="openDrawerWithCustomer('${order.userPhone}', '${escapeHtml(order.username)}')" style="font-size: 0.78rem;">
          📱 ${order.userPhone || 'N/A'}
        </div>
      </td>
      <td>
        <div style="font-size: 0.82rem; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(itemsSummary)}">
          ${escapeHtml(itemsSummary)}
        </div>
        <div style="font-size: 0.78rem; color: #34d399; font-weight: 600;">₹${order.amount || 0}</div>
      </td>
      <td>
        <select class="filter-select" onchange="updateOrderStatus('${order.id}', this.value)" style="padding: 4px 8px; font-size: 0.8rem;">
          ${['Pending', 'Preparing', 'Cooking', 'Ready for Pickup', 'Delivered', 'Cancelled'].map(s => 
            `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <div style="font-size: 0.82rem;">${etaDisplay}</div>
        ${order.isStuck ? '<span class="status-badge" style="padding: 1px 6px; font-size: 0.65rem; margin-top: 2px;">⚠️ Stuck</span>' : ''}
      </td>
      <td>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <button class="btn-bump" onclick="quickBumpEta('${order.id}', 10)" title="Extend ETA +10 min">+10m</button>
          <button class="btn-bump btn-bump-alert" onclick="openDelayModal('${order.id}', '${order.userPhone}', '${escapeHtml(order.username)}')" title="Send Delay Notice">🚨 Delay</button>
          <button class="btn-bump btn-bump-primary" onclick="openDrawerWithCustomer('${order.userPhone}', '${escapeHtml(order.username)}')" title="Chat on WhatsApp">💬</button>
        </div>
      </td>
    `;
    ordersBody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Render Tickets List
// ═══════════════════════════════════════════════════════════════════

function renderTicketsList() {
  if (!state || !ticketsList) return;

  let tickets = state.tickets || [];

  if (activeTicketFilter === 'open') {
    tickets = tickets.filter(t => t.status !== 'Resolved');
  } else if (activeTicketFilter === 'resolved') {
    tickets = tickets.filter(t => t.status === 'Resolved');
  }

  if (tickets.length === 0) {
    ticketsList.innerHTML = `<div class="empty-state">No support tickets in this view.</div>`;
    return;
  }

  ticketsList.innerHTML = '';

  tickets.forEach(ticket => {
    const card = document.createElement('div');
    const statusClass = (ticket.status || 'open').toLowerCase();
    card.className = `ticket-card ${statusClass}`;

    const dateStr = ticket.timestamp ? formatTime(ticket.timestamp) : 'Recent';

    card.innerHTML = `
      <div class="ticket-header" style="cursor: pointer;" onclick="openTicketChat('${ticket.id}')">
        <div>
          <strong style="color: #fff; font-size: 0.88rem;">${ticket.orderId || ticket.id}</strong>
          <span style="font-size: 0.72rem; color: var(--text-muted); margin-left: 6px;">${dateStr}</span>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="status-badge ${ticket.status === 'Resolved' ? 'online' : ''}" style="padding: 2px 8px; font-size: 0.7rem;">
            ${ticket.status || 'Open'}
          </span>
        </div>
      </div>
      <div style="font-size: 0.8rem; color: #cbd5e1; cursor: pointer;" onclick="openTicketChat('${ticket.id}')">
        ${escapeHtml(ticket.description || 'No description provided')}
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
        <span>Customer: <strong class="customer-link" onclick="openDrawerWithCustomer('${ticket.userPhone}', '${escapeHtml(ticket.customerName || '')}')">${ticket.userPhone || 'N/A'}</strong></span>
        <div style="display: flex; gap: 4px;">
          <button class="btn-bump btn-bump-primary" onclick="openTicketChat('${ticket.id}')" title="Open Real-Time WSS Live Support Chat">💬 Live Chat</button>
          ${ticket.status !== 'Resolved' ? `<button class="btn-bump" onclick="resolveTicket('${ticket.id}')">Resolve</button>` : ''}
        </div>
      </div>
    `;
    ticketsList.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Live Ticket WSS Chat Hub
// ═══════════════════════════════════════════════════════════════════

function openTicketChat(ticketId) {
  const ticket = (state && state.tickets) ? state.tickets.find(t => String(t.id) === String(ticketId)) : null;
  if (!ticket) {
    showToast('Ticket details not found');
    return;
  }

  activeTicketChatId = String(ticketId);
  ticketChatTitle.textContent = `Ticket #${ticket.id}`;
  ticketChatSubtitle.innerHTML = `Customer: <b>${escapeHtml(ticket.customerName || 'Customer')}</b> (${ticket.userPhone || 'N/A'}) | Order: <b>#${escapeHtml(ticket.orderId || 'N/A')}</b>`;
  
  if (ticketChatStatusSelect) {
    ticketChatStatusSelect.value = (ticket.status || 'OPEN').toUpperCase();
  }

  // Populate Order details in top bar
  const relatedOrder = (state && state.orders) ? state.orders.find(o => String(o.id) === String(ticket.orderId)) : null;
  if (relatedOrder) {
    const items = (relatedOrder.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Items';
    ticketChatOrderDetails.innerHTML = `
      <strong>Order #${relatedOrder.id}:</strong> ₹${relatedOrder.amount || 0} • ${escapeHtml(items)} • Status: <b>${relatedOrder.status}</b>
    `;
    ticketChatBumpBtn.onclick = () => quickBumpEta(relatedOrder.id, 10);
    ticketChatOrderBar.style.display = 'flex';
  } else {
    ticketChatOrderDetails.innerHTML = `<strong>Order #${ticket.orderId || 'N/A'}</strong> (No active kitchen queue details)`;
    ticketChatBumpBtn.onclick = () => showToast('Order not in active kitchen queue');
    ticketChatOrderBar.style.display = 'flex';
  }

  // Multi-option phone/SMS fallback if customer doesn't respond on WhatsApp
  if (ticketCallCustomerBtn) {
    if (ticket.userPhone) {
      const cleanDigits = ticket.userPhone.replace(/\D/g, '');
      const fullPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
      ticketCallCustomerBtn.href = `tel:${fullPhone}`;
      ticketCallCustomerBtn.style.display = 'inline-flex';
    } else {
      ticketCallCustomerBtn.style.display = 'none';
    }
  }
  if (ticketSmsCustomerBtn) {
    if (ticket.userPhone) {
      const cleanDigits = ticket.userPhone.replace(/\D/g, '');
      const fullPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
      ticketSmsCustomerBtn.href = `sms:${fullPhone}?body=${encodeURIComponent(`Hi ${ticket.customerName || 'Customer'}, support desk update regarding OnFood order #${ticket.orderId || ticket.id}: `)}`;
      ticketSmsCustomerBtn.style.display = 'inline-flex';
    } else {
      ticketSmsCustomerBtn.style.display = 'none';
    }
  }

  // Reset reply channel to Multi-channel by default (In-App + WhatsApp)
  selectedReplyChannel = 'BOTH';
  document.querySelectorAll('#ticketChatChannelGroup .channel-pill').forEach(p => {
    if (p.getAttribute('data-channel') === 'BOTH') p.classList.add('active');
    else p.classList.remove('active');
  });
  if (channelHintText) {
    channelHintText.textContent = 'Multi-channel: Delivers to customer In-App chat and dispatches WhatsApp notification';
  }

  ticketChatStream.innerHTML = '<div class="empty-state">Loading real-time message stream...</div>';
  ticketChatModal.classList.add('open');

  // Join WSS Room
  socket.emit('ticket:join', { ticketId: activeTicketChatId });

  // Focus input
  setTimeout(() => ticketChatInput && ticketChatInput.focus(), 150);
}

function closeTicketChat() {
  if (activeTicketChatId) {
    socket.emit('ticket:leave', { ticketId: activeTicketChatId });
  }
  activeTicketChatId = null;
  ticketChatModal.classList.remove('open');
}

function renderTicketChatMessages(messages) {
  if (!ticketChatStream) return;
  if (!messages || messages.length === 0) {
    ticketChatStream.innerHTML = '<div class="empty-state">No messages in this ticket yet. Start the conversation below!</div>';
    return;
  }

  ticketChatStream.innerHTML = '';
  messages.forEach(msg => appendTicketChatMessage(msg, false));
  ticketChatStream.scrollTop = ticketChatStream.scrollHeight;
}

function appendTicketChatMessage(msg, autoScroll = true) {
  if (!ticketChatStream) return;
  const emptyState = ticketChatStream.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const isAgent = msg.sender_type === 'AGENT';
  const bubble = document.createElement('div');
  bubble.className = `support-bubble ${isAgent ? 'agent' : 'customer'}`;

  const senderLabel = isAgent ? (msg.sender_name || 'Support Desk') : (msg.sender_name || 'Customer');
  const timeStr = msg.created_at ? formatTime(new Date(msg.created_at).getTime()) : 'Just now';

  let channelTag = '';
  if (msg.channel === 'APP') {
    channelTag = '<span class="msg-channel-tag tag-app">💬 In-App</span>';
  } else if (msg.channel === 'WHATSAPP') {
    channelTag = '<span class="msg-channel-tag tag-whatsapp">📱 WhatsApp</span>';
  } else if (msg.channel === 'BOTH') {
    channelTag = '<span class="msg-channel-tag tag-both">⚡ Both</span>';
  }

  bubble.innerHTML = `
    <div class="support-bubble-header">
      <div>
        <span>${escapeHtml(senderLabel)}</span>
        ${channelTag}
      </div>
      <span class="support-bubble-time">${timeStr}</span>
    </div>
    <div style="font-size: 0.88rem; white-space: pre-wrap;">${escapeHtml(msg.message || '')}</div>
  `;

  ticketChatStream.appendChild(bubble);
  if (autoScroll) {
    ticketChatStream.scrollTop = ticketChatStream.scrollHeight;
  }
}

function sendTicketChatMessage() {
  if (!activeTicketChatId) return;
  const text = (ticketChatInput.value || '').trim();
  if (!text) return;

  socket.emit('ticket:send_message', {
    ticketId: activeTicketChatId,
    message: text,
    senderType: 'AGENT',
    senderName: 'Support Agent',
    channel: selectedReplyChannel
  });

  ticketChatInput.value = '';
  socket.emit('ticket:typing', { ticketId: activeTicketChatId, senderName: 'Support Agent', isTyping: false });
}


// ═══════════════════════════════════════════════════════════════════
//  WhatsApp Side Option (Drawer) Logic
// ═══════════════════════════════════════════════════════════════════

function openDrawer() {
  whatsappDrawer.classList.add('open');
  drawerBackdrop.classList.add('open');
}

function closeDrawer() {
  whatsappDrawer.classList.remove('open');
  drawerBackdrop.classList.remove('open');
}

function openDrawerWithCustomer(phone, name) {
  if (!phone) {
    showToast('Customer phone number not available');
    return;
  }
  const cleanPhone = phone.replace(/\D/g, '');
  selectedContactPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  drawerTargetPhone.value = cleanPhone.slice(-10);
  activeChatName.textContent = name || `Customer (${cleanPhone})`;
  activeChatPhone.textContent = `+${selectedContactPhone}`;
  drawerClearFilterBtn.style.display = 'inline-block';

  renderDrawerContacts();
  renderDrawerMessages();
  openDrawer();
}

function renderDrawerContacts() {
  if (!drawerContactsList) return;

  const query = (drawerContactSearch.value || '').trim().toLowerCase();
  const contactsMap = new Map();

  allMessages.forEach(msg => {
    if (!msg.phone) return;
    const phone = msg.phone;
    if (!contactsMap.has(phone)) {
      contactsMap.set(phone, {
        phone,
        name: msg.contactName || '',
        lastMsg: msg.body || '',
        timestamp: msg.timestamp || 0,
        unread: msg.direction === 'incoming' ? 1 : 0
      });
    } else {
      const c = contactsMap.get(phone);
      if (msg.timestamp > c.timestamp) {
        c.lastMsg = msg.body || '';
        c.timestamp = msg.timestamp;
      }
      if (msg.direction === 'incoming') c.unread++;
    }
  });

  let contacts = Array.from(contactsMap.values()).sort((a, b) => b.timestamp - a.timestamp);

  if (query) {
    contacts = contacts.filter(c =>
      c.phone.includes(query) || (c.name && c.name.toLowerCase().includes(query))
    );
  }

  if (contacts.length === 0) {
    drawerContactsList.innerHTML = `<div class="empty-state" style="padding: 15px;">No active conversations.</div>`;
    return;
  }

  drawerContactsList.innerHTML = '';
  contacts.forEach(c => {
    const item = document.createElement('div');
    const isSelected = selectedContactPhone === c.phone;
    item.className = `drawer-contact-item ${isSelected ? 'selected' : ''}`;
    item.onclick = () => {
      selectedContactPhone = c.phone;
      drawerTargetPhone.value = c.phone.slice(-10);
      activeChatName.textContent = c.name || `+${c.phone}`;
      activeChatPhone.textContent = `+${c.phone}`;
      drawerClearFilterBtn.style.display = 'inline-block';
      renderDrawerContacts();
      renderDrawerMessages();
    };

    const initial = (c.name || c.phone.slice(-4)).charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="drawer-avatar">${initial}</div>
      <div style="flex: 1; overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.82rem; color: #e9edef;">${escapeHtml(c.name || '+' + c.phone)}</strong>
          <span style="font-size: 0.65rem; color: #8696a0;">${formatTime(c.timestamp)}</span>
        </div>
        <div style="font-size: 0.72rem; color: #8696a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(c.lastMsg)}
        </div>
      </div>
    `;
    drawerContactsList.appendChild(item);
  });
}

function renderDrawerMessages() {
  if (!drawerMessagesStream) return;

  let messages = allMessages;
  if (selectedContactPhone) {
    messages = allMessages.filter(m => m.phone === selectedContactPhone);
  }

  if (messages.length === 0) {
    drawerMessagesStream.innerHTML = `<div class="empty-state">No messages in this conversation.</div>`;
    return;
  }

  drawerMessagesStream.innerHTML = '';

  messages.forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = `wa-bubble ${msg.direction === 'outgoing' ? 'outgoing' : 'incoming'}`;
    const timeStr = msg.timestamp ? formatTime(msg.timestamp) : '';

    let statusTick = '';
    if (msg.direction === 'outgoing') {
      statusTick = msg.status === 'sent' ? '✓✓' : '⌛';
    }

    bubble.innerHTML = `
      <div>${escapeHtml(msg.body || '')}</div>
      <div class="wa-bubble-time">${timeStr} ${statusTick}</div>
    `;
    drawerMessagesStream.appendChild(bubble);
  });

  drawerMessagesStream.scrollTop = drawerMessagesStream.scrollHeight;
}

function updateUnreadCount() {
  const incomingCount = allMessages.filter(m => m.direction === 'incoming').length;
  if (incomingCount > 0) {
    drawerUnreadBadge.style.display = 'inline-block';
    drawerUnreadBadge.textContent = incomingCount;
    floatingUnreadBadge.style.display = 'inline-block';
    floatingUnreadBadge.textContent = incomingCount;
  } else {
    drawerUnreadBadge.style.display = 'none';
    floatingUnreadBadge.style.display = 'none';
  }
}

async function sendDrawerMessage() {
  const phone = drawerTargetPhone.value.trim();
  const message = drawerMessageText.value.trim();
  const channel = drawerChannelSelect ? drawerChannelSelect.value : 'WHATSAPP';

  if (!phone || phone.length < 10) {
    showToast('Enter valid 10-digit phone number');
    return;
  }
  if (!message) {
    showToast('Message text cannot be empty');
    return;
  }

  drawerSendBtn.disabled = true;
  drawerSendBtn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, channel })
    });
    const data = await res.json();
    if (res.ok) {
      drawerMessageText.value = '';
      showToast(channel === 'APP' ? 'Message sent via In-App chat!' : `Message sent via ${channel}!`);
    } else {
      showToast(`Error: ${data.error || 'Failed to send'}`);
    }
  } catch (err) {
    showToast('Network error while sending message');
  } finally {
    drawerSendBtn.disabled = false;
    drawerSendBtn.textContent = 'Send';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  API Support Actions
// ═══════════════════════════════════════════════════════════════════

async function updateOrderStatus(orderId, status) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      showToast(`Order #${orderId} marked as ${status}`);
    } else {
      showToast('Failed to update status');
    }
  } catch (err) {
    showToast('Error updating status');
  }
}

async function quickBumpEta(orderId, minutes) {
  try {
    const res = await fetch(`/api/orders/${orderId}/bump-eta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    });
    if (res.ok) {
      showToast(`Extended order #${orderId} ETA by +${minutes}m`);
    } else {
      showToast('Failed to extend ETA');
    }
  } catch (err) {
    showToast('Network error');
  }
}

function openDelayModal(orderId, phone, customerName) {
  delayModalOrderId.value = orderId;
  delayModalCustomer.value = `${customerName || 'Customer'} (${phone || 'N/A'})`;
  delayModalMessage.value = `⏱️ *Update on your OnFood Order #${orderId}*\n\nHi ${customerName || 'Customer'}, your meal is currently being freshly prepared by our chefs.\nDue to kitchen queue, estimated readiness is delayed by ~10 minutes.\n\nWe apologize for the wait and appreciate your understanding! 🙏🍔`;
  delayAlertModal.classList.add('open');
}

async function sendDelayAlert() {
  const orderId = delayModalOrderId.value;
  const minutes = Number(delayModalMinutes.value);
  const message = delayModalMessage.value.trim();

  try {
    const res = await fetch(`/api/orders/${orderId}/delay-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes, message })
    });
    const data = await res.json();
    if (res.ok) {
      delayAlertModal.classList.remove('open');
      showToast(data.sentWhatsApp ? 'Delay notice sent via WhatsApp!' : 'ETA bumped (WhatsApp disconnected)');
    } else {
      showToast(`Error: ${data.error || 'Failed to send'}`);
    }
  } catch (err) {
    showToast('Network error sending delay notice');
  }
}

async function replyToTicket(ticketId) {
  const input = document.getElementById(`ticketReplyInput_${ticketId}`);
  if (!input) return;
  const message = input.value.trim();
  if (!message) {
    showToast('Reply message cannot be empty');
    return;
  }

  try {
    const res = await fetch(`/api/tickets/${ticketId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (res.ok) {
      input.value = '';
      showToast('WhatsApp reply sent to customer!');
    } else {
      showToast('Failed to reply to ticket');
    }
  } catch (err) {
    showToast('Network error');
  }
}

async function resolveTicket(ticketId) {
  try {
    const res = await fetch(`/api/tickets/${ticketId}/resolve`, {
      method: 'POST'
    });
    if (res.ok) {
      showToast(`Ticket #${ticketId} resolved`);
    } else {
      showToast('Failed to resolve ticket');
    }
  } catch (err) {
    showToast('Network error');
  }
}

async function createManualTicket() {
  const orderId = document.getElementById('ticketModalOrderId').value.trim();
  const userPhone = document.getElementById('ticketModalPhone').value.trim();
  const category = document.getElementById('ticketModalCategory').value;
  const description = document.getElementById('ticketModalDesc').value.trim();

  if (!description) {
    showToast('Please provide an issue description');
    return;
  }

  try {
    const res = await fetch('/api/tickets/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, userPhone, category, description })
    });
    if (res.ok) {
      newTicketModal.classList.remove('open');
      document.getElementById('ticketModalDesc').value = '';
      showToast('Support ticket created successfully!');
    } else {
      showToast('Failed to create ticket');
    }
  } catch (err) {
    showToast('Network error');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Bot Settings Modal Logic
// ═══════════════════════════════════════════════════════════════════

function populateSettingsForm(s) {
  if (!s) return;
  if (s.rateLimits) {
    if (settingsInputs.minDelayMs) settingsInputs.minDelayMs.value = s.rateLimits.minDelayMs;
    if (settingsInputs.maxDelayMs) settingsInputs.maxDelayMs.value = s.rateLimits.maxDelayMs;
    if (settingsInputs.perRecipientPerMinute) settingsInputs.perRecipientPerMinute.value = s.rateLimits.perRecipientPerMinute;
    if (settingsInputs.globalPerMinute) settingsInputs.globalPerMinute.value = s.rateLimits.globalPerMinute;
  }
  if (s.humanBehavior) {
    if (settingsInputs.typingEnabled) settingsInputs.typingEnabled.checked = Boolean(s.humanBehavior.typingEnabled);
    if (settingsInputs.readReceiptsEnabled) settingsInputs.readReceiptsEnabled.checked = Boolean(s.humanBehavior.readReceiptsEnabled);
    if (settingsInputs.responseDelayMinMs) settingsInputs.responseDelayMinMs.value = s.humanBehavior.responseDelayMinMs;
    if (settingsInputs.responseDelayMaxMs) settingsInputs.responseDelayMaxMs.value = s.humanBehavior.responseDelayMaxMs;
    if (settingsInputs.typingSpeedCPM) settingsInputs.typingSpeedCPM.value = s.humanBehavior.typingSpeedCPM;
  }
  if (s.bufferingTimeMinutes && settingsInputs.bufferingTimeMinutes) {
    settingsInputs.bufferingTimeMinutes.value = s.bufferingTimeMinutes;
  }
  if (s.botRelay) {
    if (settingsInputs.botRelayEnabled) settingsInputs.botRelayEnabled.checked = Boolean(s.botRelay.enabled !== false);
    if (settingsInputs.botRelayMode) settingsInputs.botRelayMode.value = s.botRelay.mode || 'hybrid';
    if (settingsInputs.relayToHumanOnTicket) settingsInputs.relayToHumanOnTicket.checked = Boolean(s.botRelay.relayToHumanOnTicket !== false);
    if (settingsInputs.autoReplyDelaySec) settingsInputs.autoReplyDelaySec.value = s.botRelay.autoReplyDelaySec || 2;
    if (settingsInputs.customGreeting) settingsInputs.customGreeting.value = s.botRelay.customGreeting || '';
    if (settingsInputs.customHelpMenu) settingsInputs.customHelpMenu.value = s.botRelay.customHelpMenu || '';
    if (settingsInputs.customDelayApology) settingsInputs.customDelayApology.value = s.botRelay.customDelayApology || '';
    if (settingsInputs.customReadyMessage) settingsInputs.customReadyMessage.value = s.botRelay.customReadyMessage || '';
  }
}

async function saveSettings() {
  const payload = {
    rateLimits: {
      minDelayMs: Number(settingsInputs.minDelayMs.value),
      maxDelayMs: Number(settingsInputs.maxDelayMs.value),
      perRecipientPerMinute: Number(settingsInputs.perRecipientPerMinute.value),
      globalPerMinute: Number(settingsInputs.globalPerMinute.value),
    },
    humanBehavior: {
      typingEnabled: settingsInputs.typingEnabled.checked,
      readReceiptsEnabled: settingsInputs.readReceiptsEnabled.checked,
      responseDelayMinMs: Number(settingsInputs.responseDelayMinMs.value),
      responseDelayMaxMs: Number(settingsInputs.responseDelayMaxMs.value),
      typingSpeedCPM: Number(settingsInputs.typingSpeedCPM.value),
    },
    bufferingTimeMinutes: Number(settingsInputs.bufferingTimeMinutes.value),
    botRelay: {
      enabled: Boolean(settingsInputs.botRelayEnabled?.checked),
      mode: settingsInputs.botRelayMode?.value || 'hybrid',
      relayToHumanOnTicket: Boolean(settingsInputs.relayToHumanOnTicket?.checked),
      autoReplyDelaySec: Number(settingsInputs.autoReplyDelaySec?.value || 2),
      customGreeting: settingsInputs.customGreeting?.value?.trim() || '',
      customHelpMenu: settingsInputs.customHelpMenu?.value?.trim() || '',
      customDelayApology: settingsInputs.customDelayApology?.value?.trim() || '',
      customReadyMessage: settingsInputs.customReadyMessage?.value?.trim() || ''
    }
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      settingsModal.classList.remove('open');
      showToast('Bot settings saved successfully!');
    } else {
      showToast('Failed to save settings');
    }
  } catch (err) {
    showToast('Network error');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UI Event Listeners & Shortcuts
// ═══════════════════════════════════════════════════════════════════

// Drawer toggles
toggleDrawerBtn.onclick = openDrawer;
floatingDrawerTrigger.onclick = openDrawer;
closeDrawerBtn.onclick = closeDrawer;
drawerBackdrop.onclick = closeDrawer;

// Drawer Clear Filter
drawerClearFilterBtn.onclick = () => {
  selectedContactPhone = null;
  drawerTargetPhone.value = '';
  activeChatName.textContent = 'All Messages Feed';
  activeChatPhone.textContent = 'Select a conversation or type phone below';
  drawerClearFilterBtn.style.display = 'none';
  renderDrawerContacts();
  renderDrawerMessages();
};

drawerContactSearch.oninput = renderDrawerContacts;
drawerSendBtn.onclick = sendDrawerMessage;
drawerMessageText.onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendDrawerMessage();
  }
};

// Canned Macros
document.querySelectorAll('.canned-chip').forEach(chip => {
  chip.onclick = () => {
    drawerMessageText.value = chip.getAttribute('data-text');
    drawerMessageText.focus();
  };
});

// Jump to Delayed Orders
jumpDelayedBtn.onclick = () => {
  activeStatusFilter = 'DELAYED';
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  tabDelayedFilter.classList.add('active');
  renderOrdersTable();
  ordersBody.scrollIntoView({ behavior: 'smooth' });
};

// Status Filter Tabs
document.querySelectorAll('.filter-tab[data-status]').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.filter-tab[data-status]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeStatusFilter = tab.getAttribute('data-status');
    renderOrdersTable();
  };
});

orderSearch.oninput = renderOrdersTable;

// Ticket Filter Tabs
ticketFilterAll.onclick = () => {
  ticketFilterAll.classList.add('active');
  ticketFilterOpen.classList.remove('active');
  ticketFilterResolved.classList.remove('active');
  activeTicketFilter = 'all';
  renderTicketsList();
};
ticketFilterOpen.onclick = () => {
  ticketFilterAll.classList.remove('active');
  ticketFilterOpen.classList.add('active');
  ticketFilterResolved.classList.remove('active');
  activeTicketFilter = 'open';
  renderTicketsList();
};
ticketFilterResolved.onclick = () => {
  ticketFilterAll.classList.remove('active');
  ticketFilterOpen.classList.remove('active');
  ticketFilterResolved.classList.add('active');
  activeTicketFilter = 'resolved';
  renderTicketsList();
};

// Modals
openNewTicketBtn.onclick = () => newTicketModal.classList.add('open');
quickNewTicketBtn.onclick = () => newTicketModal.classList.add('open');
closeNewTicketBtn.onclick = () => newTicketModal.classList.remove('open');
cancelNewTicketBtn.onclick = () => newTicketModal.classList.remove('open');
submitNewTicketBtn.onclick = createManualTicket;

closeDelayAlertBtn.onclick = () => delayAlertModal.classList.remove('open');
cancelDelayAlertBtn.onclick = () => delayAlertModal.classList.remove('open');
submitDelayAlertBtn.onclick = sendDelayAlert;

openSettingsBtn.onclick = () => settingsModal.classList.add('open');
closeSettingsBtn.onclick = () => settingsModal.classList.remove('open');
saveSettingsBtn.onclick = saveSettings;
resetDefaultsBtn.onclick = async () => {
  const res = await fetch('/api/settings/reset', { method: 'POST' });
  if (res.ok) {
    showToast('Reset settings to default');
    settingsModal.classList.remove('open');
  }
};

// Ticket Chat Modal Listeners
if (closeTicketChatBtn) closeTicketChatBtn.onclick = closeTicketChat;
if (ticketChatSendBtn) ticketChatSendBtn.onclick = sendTicketChatMessage;
if (ticketChatInput) {
  ticketChatInput.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTicketChatMessage();
    }
  };
  ticketChatInput.oninput = () => {
    if (!activeTicketChatId) return;
    socket.emit('ticket:typing', { ticketId: activeTicketChatId, senderName: 'Support Agent', isTyping: true });
    clearTimeout(ticketTypingTimeout);
    ticketTypingTimeout = setTimeout(() => {
      socket.emit('ticket:typing', { ticketId: activeTicketChatId, senderName: 'Support Agent', isTyping: false });
    }, 1500);
  };
}

if (ticketChatStatusSelect) {
  ticketChatStatusSelect.onchange = () => {
    if (!activeTicketChatId) return;
    socket.emit('ticket:status_change', { ticketId: activeTicketChatId, status: ticketChatStatusSelect.value });
  };
}

// Canned Macros for Ticket Chat
document.querySelectorAll('.ticket-canned-chip').forEach(chip => {
  chip.onclick = () => {
    if (!ticketChatInput) return;
    ticketChatInput.value = chip.getAttribute('data-text');
    ticketChatInput.focus();
  };
});

// Channel Selector Pills for Ticket Chat
document.querySelectorAll('#ticketChatChannelGroup .channel-pill').forEach(pill => {
  pill.onclick = () => {
    document.querySelectorAll('#ticketChatChannelGroup .channel-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedReplyChannel = pill.getAttribute('data-channel');
    if (channelHintText) {
      if (selectedReplyChannel === 'APP') {
        channelHintText.textContent = 'Primary: Real-time In-App chat delivered directly to customer mobile app';
      } else if (selectedReplyChannel === 'WHATSAPP') {
        channelHintText.textContent = 'Fallback: Dispatches WhatsApp message to customer phone';
      } else if (selectedReplyChannel === 'BOTH') {
        channelHintText.textContent = 'Multi-channel: Delivers to customer In-App chat and dispatches WhatsApp notification';
      }
    }
  };
});



// Keyboard shortcut: Alt+W opens/closes WhatsApp Desk
window.addEventListener('keydown', e => {
  if (e.altKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    if (whatsappDrawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
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

function showToast(msg) {
  if (!toastNotification) return;
  toastNotification.textContent = msg;
  toastNotification.classList.add('show');
  setTimeout(() => toastNotification.classList.remove('show'), 3500);
}
