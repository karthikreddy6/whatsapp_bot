// WhatsApp Messages Client Logic
-const socket = io();

let allMessages = [];
let selectedPhone = null;
let currentSettings = null;

// DOM Elements
const whatsappStatus = document.getElementById('whatsappStatus');
const statusText = document.getElementById('statusText');
const contactsList = document.getElementById('contactsList');
const messagesStream = document.getElementById('messagesStream');
const contactSearch = document.getElementById('contactSearch');
const currentContactTitle = document.getElementById('currentContactTitle');
const currentContactSubtitle = document.getElementById('currentContactSubtitle');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const targetPhoneInput = document.getElementById('targetPhoneInput');
const messageTextInput = document.getElementById('messageTextInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');

// Modal Elements
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

socket.on('dashboard:update', state => {
  if (state && typeof state.whatsappReady === 'boolean') {
    updateStatus(state.whatsappReady, state.whatsappReady ? 'Online & Ready' : 'Connecting / QR');
  }
});

socket.on('messages:init', messages => {
  allMessages = messages || [];
  renderContacts();
  renderMessages();
});

socket.on('messages:new', msg => {
  allMessages.push(msg);
  renderContacts();
  renderMessages();
});

socket.on('settings:update', settings => {
  currentSettings = settings;
  populateSettingsForm(settings);
});

// ═══════════════════════════════════════════════════════════════════
//  Status Badge
// ═══════════════════════════════════════════════════════════════════

function updateStatus(isOnline, text) {
  if (isOnline) {
    whatsappStatus.className = 'status-badge online';
    statusText.textContent = text || 'Online';
  } else {
    whatsappStatus.className = 'status-badge';
    statusText.textContent = text || 'Connecting';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Contacts List
// ═══════════════════════════════════════════════════════════════════

function renderContacts() {
  const query = (contactSearch.value || '').toLowerCase().trim();
  const contactsMap = new Map();

  allMessages.forEach(msg => {
    const phone = msg.phone;
    if (!phone) return;
    if (!contactsMap.has(phone)) {
      contactsMap.set(phone, {
        phone,
        name: msg.contactName || '',
        lastMessage: msg.body,
        lastTimestamp: msg.timestamp,
        count: 1
      });
    } else {
      const contact = contactsMap.get(phone);
      if (msg.contactName && !contact.name) contact.name = msg.contactName;
      if (msg.timestamp >= contact.lastTimestamp) {
        contact.lastMessage = msg.body;
        contact.lastTimestamp = msg.timestamp;
      }
      contact.count++;
    }
  });

  const contacts = Array.from(contactsMap.values())
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .filter(c => {
      if (!query) return true;
      return c.phone.includes(query) || (c.name && c.name.toLowerCase().includes(query));
    });

  if (!contacts.length) {
    contactsList.innerHTML = '<div class="empty-state">No conversations match.</div>';
    return;
  }

  contactsList.innerHTML = contacts.map(c => {
    const isActive = selectedPhone === c.phone ? 'active' : '';
    const initial = (c.name ? c.name[0] : (c.phone[c.phone.length - 1] || 'U')).toUpperCase();
    return `
      <div class="contact-item ${isActive}" onclick="selectContact('${escapeHtml(c.phone)}')">
        <div class="contact-avatar">${escapeHtml(initial)}</div>
        <div class="contact-info">
          <div class="contact-title-row">
            <span class="contact-name">${escapeHtml(c.name || formatPhone(c.phone))}</span>
            <span class="contact-time">${formatTimeShort(c.lastTimestamp)}</span>
          </div>
          <div class="contact-snippet">${escapeHtml(c.lastMessage || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.selectContact = function(phone) {
  selectedPhone = phone;
  targetPhoneInput.value = phone;
  currentContactTitle.textContent = formatPhone(phone);
  currentContactSubtitle.textContent = `Showing messages for ${phone}`;
  clearFilterBtn.style.display = 'inline-block';
  renderContacts();
  renderMessages();
};

clearFilterBtn.addEventListener('click', () => {
  selectedPhone = null;
  currentContactTitle.textContent = 'All Messages Feed';
  currentContactSubtitle.textContent = 'Showing all real-time WhatsApp incoming & outgoing traffic';
  clearFilterBtn.style.display = 'none';
  renderContacts();
  renderMessages();
});

contactSearch.addEventListener('input', renderContacts);

// ═══════════════════════════════════════════════════════════════════
//  Messages Stream
// ═══════════════════════════════════════════════════════════════════

function renderMessages() {
  const filtered = selectedPhone
    ? allMessages.filter(m => m.phone === selectedPhone)
    : allMessages;

  if (!filtered.length) {
    messagesStream.innerHTML = '<div class="empty-state">No messages to display.</div>';
    return;
  }

  const isAtBottom = messagesStream.scrollHeight - messagesStream.clientHeight <= messagesStream.scrollTop + 50;

  messagesStream.innerHTML = filtered.map(m => {
    const isOut = m.direction === 'outgoing';
    const bubbleClass = isOut ? 'outgoing' : 'incoming';
    const failedClass = m.status === 'failed' ? 'failed' : '';
    const author = isOut ? 'OnFood Bot' : (m.contactName || formatPhone(m.phone));
    const tagClass = m.type || 'text';

    return `
      <div class="message-bubble ${bubbleClass} ${failedClass}">
        <div class="msg-header">
          <span class="msg-author">${escapeHtml(author)}</span>
          <span class="msg-tag ${tagClass}">${escapeHtml(m.type || 'text')}</span>
        </div>
        <div class="msg-content">${escapeHtml(m.body || '')}</div>
        <div class="msg-footer">
          <span>${formatTime(m.timestamp)}</span>
          ${isOut ? `<span>${m.status === 'failed' ? '❌ Failed' : '✓✓'}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  if (isAtBottom) {
    messagesStream.scrollTop = messagesStream.scrollHeight;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Send Quick Message (Throttled & Delayed Naturally)
// ═══════════════════════════════════════════════════════════════════

sendMsgBtn.addEventListener('click', handleSendMessage);
messageTextInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSendMessage();
});

async function handleSendMessage() {
  const phone = (targetPhoneInput.value || '').trim();
  const text = (messageTextInput.value || '').trim();

  if (!phone) {
    showToast('Please enter recipient phone number');
    targetPhoneInput.focus();
    return;
  }
  if (!text) {
    showToast('Please type a message');
    messageTextInput.focus();
    return;
  }

  sendMsgBtn.disabled = true;
  sendMsgBtn.textContent = 'Queuing...';

  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: text })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      messageTextInput.value = '';
      showToast('Message queued with human delays & rate limiting');
    } else {
      showToast(data.error || 'Failed to send message');
    }
  } catch (err) {
    showToast('Network error: ' + err.message);
  } finally {
    sendMsgBtn.disabled = false;
    sendMsgBtn.textContent = 'Send';
  }
}

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
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(timestamp));
}

function formatTimeShort(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return formatTime(timestamp);
  }
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial fetch if socket not yet loaded
fetch('/api/messages')
  .then(res => res.json())
  .then(data => {
    if (data && data.messages && !allMessages.length) {
      allMessages = data.messages;
      renderContacts();
      renderMessages();
    }
  })
  .catch(() => {});
