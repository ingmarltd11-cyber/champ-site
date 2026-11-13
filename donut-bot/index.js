'use strict';

/*
 * Champ DonutSMP payment bot.
 *
 * The bot stays connected to DonutSMP, polls the website for pending orders, and watches
 * chat for incoming payments. When a payment matches an order (same username, enough
 * money) it calls the website's webhook. The website decides whether to unlock the
 * license; this bot never writes to the database directly.
 *
 * Required environment variables:
 *   MC_EMAIL         Microsoft account e-mail for the bot's Minecraft account
 *   DONUT_BOT_TOKEN  shared secret, also set on the Vercel site
 *   CHAMP_API_URL    https://your-site.example
 *
 * The account must own Minecraft Java and be able to sign in with Microsoft. The first
 * sign-in prints a device-code link; complete it once and keep the profiles folder on a
 * persistent volume so a restart does not need another code.
 */

require('dotenv').config();

const http = require('http');
const path = require('path');
const mineflayer = require('mineflayer');

const API_URL = (process.env.CHAMP_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.DONUT_BOT_TOKEN || '';
const MC_EMAIL = process.env.MC_EMAIL || '';
const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.4';
const PROFILES = process.env.MC_PROFILES_DIR || path.join(__dirname, '.minecraft-auth');
const POLL_MS = Math.max(5000, Number(process.env.POLL_MS || 15000));
const RECONNECT_MS = Math.max(5000, Number(process.env.RECONNECT_MS || 30000));

// DonutSMP can change its wording. Set DONUT_PAY_REGEX to a named-group regex if it does:
//   (?<sender>[A-Za-z0-9_]{3,16}) paid you \$?(?<amount>[\d,]+)
const CUSTOM_REGEX = process.env.DONUT_PAY_REGEX || '';

const DEFAULT_PATTERNS = [
  /(?<sender>[A-Za-z0-9_]{3,16})\s+(?:has\s+)?paid\s+you\s+\$?(?<amount>[\d,]+)/i,
  /(?<sender>[A-Za-z0-9_]{3,16})\s+sent\s+you\s+\$?(?<amount>[\d,]+)/i,
  /you\s+(?:have\s+)?received\s+\$?(?<amount>[\d,]+)\s+from\s+(?<sender>[A-Za-z0-9_]{3,16})/i,
  /(?<sender>[A-Za-z0-9_]{3,16})\s+paid\s+you\s+\$?(?<amount>[\d,]+)\s+in\s+donut/i,
];

let bot = null;
let pending = [];
let lastPoll = 0;
let connectedAt = 0;
let reconnectTimer = null;
let stopping = false;
let authWarned = false;

if (!API_URL || !TOKEN) {
  console.error('Missing CHAMP_API_URL or DONUT_BOT_TOKEN.');
  process.exit(1);
}

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

function amountOf(text) {
  const cleaned = String(text || '').replace(/[^\d]/g, '');
  return cleaned ? Number(cleaned) : 0;
}

function paymentFromMessage(text) {
  const raw = String(text || '').replace(/\u00a7./g, '').trim();
  if (!raw) return null;
  if (CUSTOM_REGEX) {
    try {
      const match = new RegExp(CUSTOM_REGEX, 'i').exec(raw);
      if (match && match.groups && match.groups.sender && match.groups.amount) {
        return { sender: match.groups.sender, amount: amountOf(match.groups.amount) };
      }
    } catch (error) {
      if (!authWarned) {
        console.error('DONUT_PAY_REGEX is invalid:', error.message);
        authWarned = true;
      }
    }
  }
  for (const pattern of DEFAULT_PATTERNS) {
    const match = pattern.exec(raw);
    if (match && match.groups) {
      return { sender: match.groups.sender, amount: amountOf(match.groups.amount) };
    }
  }
  return null;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Token': TOKEN,
      ...(options.headers || {}),
    },
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* empty response */ }
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${body.detail || ''}`.trim());
  }
  return body;
}

async function pollOrders() {
  if (stopping) return;
  try {
    const data = await api('/api/payments/bot/pending');
    const orders = Array.isArray(data.orders) ? data.orders : [];
    pending = orders
      .map(order => ({
        uid: String(order.uid || ''),
        username: String(order.username || '').trim(),
        amount: Number(order.amount || 0),
        created_at: String(order.created_at || ''),
      }))
      .filter(order => order.uid && order.username && order.amount > 0);
    lastPoll = Date.now();
    if (pending.length) log(`pending orders: ${pending.length}`);
  } catch (error) {
    log('poll failed:', error.message);
  }
}

async function confirm(order, sender, amount) {
  try {
    const result = await api('/api/payments/webhook/donut', {
      method: 'POST',
      body: JSON.stringify({ order_id: order.uid, sender, amount }),
    });
    log(`confirmed ${order.uid} from ${sender}: ${amount} (${result.status || 'paid'})`);
    pending = pending.filter(item => item.uid !== order.uid);
  } catch (error) {
    log(`confirm failed for ${order.uid}:`, error.message);
  }
}

function onChat(text) {
  const payment = paymentFromMessage(text);
  if (!payment) {
    log('chat:', text.slice(0, 200));
    return;
  }
  log(`payment chat from ${payment.sender}: ${payment.amount}`);

  const matches = pending.filter(order =>
    order.username.toLowerCase() === payment.sender.toLowerCase()
    && payment.amount >= order.amount
  );
  if (!matches.length) {
    log('no pending order matches this payment');
    return;
  }
  // The oldest matching order gets the payment. The server marks it paid, so a duplicate
  // chat line cannot unlock two licenses.
  matches.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  confirm(matches[0], payment.sender, payment.amount);
}

function scheduleReconnect(reason) {
  if (stopping || reconnectTimer) return;
  log(`reconnecting in ${RECONNECT_MS / 1000}s: ${reason}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function connect() {
  if (stopping) return;
  if (!MC_EMAIL && !process.env.MC_USERNAME) {
    console.error('Set MC_EMAIL (Microsoft account) before starting the bot.');
    return;
  }

  log(`connecting to ${MC_HOST}:${MC_PORT} as ${MC_EMAIL || process.env.MC_USERNAME}`);
  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    version: MC_VERSION,
    username: MC_EMAIL || process.env.MC_USERNAME,
    auth: process.env.MC_AUTH || 'microsoft',
    profilesFolder: PROFILES,
    hideErrors: false,
    checkTimeoutInterval: 120000,
  });

  bot.once('spawn', () => {
    connectedAt = Date.now();
    log(`spawned as ${bot.username}; watching for payments`);
    pollOrders();
  });

  bot.on('message', jsonMsg => {
    // Parse every chat position: some servers put payment messages in the action bar.
    onChat(jsonMsg.toString());
  });

  bot.on('error', error => log('mineflayer error:', error.message));
  bot.on('kicked', reason => {
    log('kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason));
  });
  bot.on('end', reason => {
    bot = null;
    connectedAt = 0;
    scheduleReconnect(reason || 'connection ended');
  });
}

// A tiny health endpoint makes Railway's healthcheck and uptime monitors useful.
const port = Number(process.env.PORT || 0);
if (port) {
  http.createServer((req, res) => {
    const healthy = Boolean(bot) && Boolean(connectedAt);
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: healthy,
      connected: Boolean(bot),
      connected_at: connectedAt || null,
      pending_orders: pending.length,
      last_poll: lastPoll || null,
    }));
  }).listen(port, '0.0.0.0', () => log(`health endpoint on :${port}`));
}

setInterval(pollOrders, POLL_MS);
process.on('SIGTERM', () => {
  stopping = true;
  if (bot) bot.quit('shutdown');
  process.exit(0);
});
process.on('SIGINT', () => {
  stopping = true;
  if (bot) bot.quit('shutdown');
  process.exit(0);
});

connect();
