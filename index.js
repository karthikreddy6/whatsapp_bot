const path = require('path');
const { fork } = require('child_process');
const { startServer } = require('./support-server');
const { loadLocalEnvironment } = require('./shared');

loadLocalEnvironment();

const ENABLE_WHATSAPP = process.env.ENABLE_WHATSAPP !== 'false';
const WHATSAPP_PORT = process.env.WHATSAPP_PORT || 3001;
const PORT = process.env.PORT || 3000;

console.log('═══════════════════════════════════════════════════════════════════');
console.log('           OnFood Support Desk & WhatsApp Architecture              ');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`[Supervisor] Mode: Separated Services Architecture`);
console.log(`[Supervisor] Customer Support Desk: Enabled (Port ${PORT})`);
console.log(`[Supervisor] WhatsApp Microservice: ${ENABLE_WHATSAPP ? `Enabled (Port ${WHATSAPP_PORT})` : 'Disabled (Set ENABLE_WHATSAPP=true to enable)'}`);
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Start Customer Support Server (Rock-solid, In-Process)
startServer();

// 2. Start WhatsApp Service (Isolated Child Process with Auto-Restart)
let whatsappChild = null;
let restartAttempts = 0;
let restartTimer = null;
let isShuttingDown = false;

function launchWhatsAppWorker() {
  if (!ENABLE_WHATSAPP || isShuttingDown) return;

  const scriptPath = path.join(__dirname, 'whatsapp-service.js');
  console.log(`[Supervisor] Spawning isolated WhatsApp microservice process...`);

  whatsappChild = fork(scriptPath, [], {
    env: {
      ...process.env,
      WHATSAPP_PORT: String(WHATSAPP_PORT),
      SUPPORT_SERVICE_URL: `http://127.0.0.1:${PORT}`
    },
    stdio: 'inherit'
  });

  whatsappChild.on('message', (msg) => {
    if (msg && msg.type === 'ready') {
      restartAttempts = 0;
    }
  });

  whatsappChild.on('exit', (code, signal) => {
    whatsappChild = null;
    if (isShuttingDown) return;

    restartAttempts++;
    const delaySec = Math.min(Math.pow(2, restartAttempts) * 2, 60);
    console.error(`\n[Supervisor] ⚠️ WhatsApp service exited (code: ${code}, signal: ${signal}).`);
    console.log(`[Supervisor] Customer Support Desk remains 100% active and unaffected.`);
    console.log(`[Supervisor] Automatically reviving WhatsApp microservice in ${delaySec}s (attempt ${restartAttempts})...\n`);

    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      launchWhatsAppWorker();
    }, delaySec * 1000);
  });

  whatsappChild.on('error', (err) => {
    console.error(`[Supervisor] WhatsApp process error:`, err.message);
  });
}

if (ENABLE_WHATSAPP) {
  launchWhatsAppWorker();
}

// ═══════════════════════════════════════════════════════════════════
//  Graceful Process Teardown
// ═══════════════════════════════════════════════════════════════════

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Supervisor] Received ${signal}. Shutting down services cleanly...`);

  clearTimeout(restartTimer);
  if (whatsappChild) {
    try {
      whatsappChild.kill('SIGTERM');
    } catch (e) {}
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
