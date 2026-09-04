// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const socket = io();
let state = null;

const elements = {
  connection: document.getElementById('connection'),
  clock: document.getElementById('clock'),
  activeOrders: document.getElementById('activeOrders'),
  recentOrders: document.getElementById('recentOrders'),
  openTickets: document.getElementById('openTickets'),
  avgDelivery: document.getElementById('avgDelivery'),
  lateOrders: document.getElementById('lateOrders'),
  ordersBody: document.getElementById('ordersBody'),
  ticketsList: document.getElementById('ticketsList'),
  statusFilter: document.getElementById('statusFilter'),
  bufferForm: document.getElementById('bufferForm'),
  bufferInput: document.getElementById('bufferInput'),
  bufferSuggestion: document.getElementById('bufferSuggestion')
};

socket.on('connect', () => {
  elements.connection.textContent = 'Dashboard live';
});

socket.on('disconnect', () => {
  elements.connection.textContent = 'Reconnecting';
});

socket.on('dashboard:update', nextState => {
  state = nextState;
  render();
});

elements.statusFilter.addEventListener('change', render);

elements.bufferForm.addEventListener('submit', async event => {
  event.preventDefault();
  await postJson('/api/buffering-time', { minutes: Number(elements.bufferInput.value) });
});

setInterval(() => {
  elements.clock.textContent = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date());
}, 1000);

function render() {
  if (!state) return;
  const metrics = state.metrics;
  elements.activeOrders.textContent = metrics.activeOrders;
  elements.recentOrders.textContent = metrics.recentOrders;
  elements.openTickets.textContent = metrics.openTickets;
  elements.avgDelivery.textContent = `${metrics.avgDeliveryMinutes || 0}m`;
  elements.lateOrders.textContent = metrics.lateOrders;
  elements.bufferInput.value = state.bufferingTimeMinutes;
  elements.bufferSuggestion.textContent = `Suggested: ${state.dynamicBuffer}m based on load`;
  renderOrders();
  renderTickets();
}

function renderOrders() {
  const statusFilter = elements.statusFilter.value;
  const now = Date.now();
  const orders = state.orders.filter(order => !statusFilter || order.status === statusFilter);

  if (!orders.length) {
    elements.ordersBody.innerHTML = '<tr><td colspan="6" class="empty">No orders found.</td></tr>';
    return;
  }

  elements.ordersBody.innerHTML = orders.map(order => {
    const late = order.etaTimestamp && order.etaTimestamp < now && !['Delivered', 'Cancelled'].includes(order.status);
    const ready = order.status === 'Ready for Pickup';
    const itemText = order.items.map(item => `${escapeHtml(item.name)} x${item.quantity}`).join('<br>');
    const statusClass = late ? 'late' : ready ? 'ready' : '';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(order.id)}</strong><br>
          <span>${formatTime(order.timestamp)}</span>
          ${order.isStuck ? '<br><span class="pill stuck">Stuck 15m+</span>' : ''}
        </td>
        <td>
          ${escapeHtml(order.username)}<br>
          <span>${escapeHtml(order.userPhone)}</span>
        </td>
        <td>${itemText || 'No items'}</td>
        <td><span class="pill ${statusClass}">${escapeHtml(order.status)}</span></td>
        <td>${formatTime(order.etaTimestamp)}${late ? '<br><span class="pill late">Late</span>' : ''}</td>
        <td>
          <div class="actions">
            ${statusButton(order.id, 'Preparing')}
            ${statusButton(order.id, 'Cooking')}
            ${statusButton(order.id, 'Ready for Pickup')}
            ${statusButton(order.id, 'Delivered')}
            <button class="secondary" onclick="setEta('${escapeHtml(order.id)}')">ETA</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTickets() {
  const tickets = state.tickets;

  if (!tickets.length) {
    elements.ticketsList.innerHTML = '<div class="empty">No support tickets.</div>';
    return;
  }

  elements.ticketsList.innerHTML = tickets.map(ticket => `
    <article class="ticket">
      <header>
        <strong>${escapeHtml(ticket.orderId)}</strong>
        <span class="pill ${ticket.status === 'Resolved' ? 'ready' : ticket.status === 'Replied' ? 'replied' : ''}">${escapeHtml(ticket.status)}</span>
      </header>
      <p>${escapeHtml(ticket.description || 'No description')}</p>
      <div class="actions">
        <button class="secondary" onclick="resolveTicket('${escapeHtml(ticket.id)}')">Resolve</button>
        <button onclick="replyTicket('${escapeHtml(ticket.id)}')">Reply WhatsApp</button>
      </div>
    </article>
  `).join('');
}

function statusButton(orderId, status) {
  return `<button onclick="updateStatus('${escapeHtml(orderId)}','${status}')">${status}</button>`;
}

async function updateStatus(orderId, status) {
  await patchJson(`/api/orders/${encodeURIComponent(orderId)}/status`, { status });
}

async function setEta(orderId) {
  const value = window.prompt('ETA minutes from now');
  if (!value) return;
  await postJson(`/api/orders/${encodeURIComponent(orderId)}/eta`, { minutes: Number(value) });
}

async function resolveTicket(ticketId) {
  await postJson(`/api/tickets/${encodeURIComponent(ticketId)}/resolve`, {});
}

async function replyTicket(ticketId) {
  const message = window.prompt('Type your reply to the customer:');
  if (!message) return;
  await postJson(`/api/tickets/${encodeURIComponent(ticketId)}/reply`, { message });
}

async function postJson(url, body) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function patchJson(url, body) {
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function formatTime(timestamp) {
  if (!timestamp) return 'Not set';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.updateStatus = updateStatus;
window.setEta = setEta;
window.resolveTicket = resolveTicket;
window.replyTicket = replyTicket;
