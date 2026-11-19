const { siteUrl } = require('../utils/format');
const { discordToken } = require('../utils/discordEnv');

// The shop owns prices, payment methods, licenses and e-mail delivery. The bot never writes a
// license itself: it calls the small bot-authenticated bridge on the website, so a Discord
// purchase goes through exactly the same checks as the web checkout.
class PaymentError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
    this.payload = payload;
  }
}

function configured() {
  return Boolean(discordToken() && siteUrl());
}

async function request(path, { method = 'GET', body = null, query = null } = {}) {
  if (!configured()) {
    throw new PaymentError('Payments need DISCORD_TOKEN and SITE_URL on the bot.', { status: 0 });
  }
  const url = new URL(`${siteUrl()}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bot ${discordToken()}`,
        'Content-Type': 'application/json',
      },
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new PaymentError('The Champ site did not answer. Try again in a moment.', { status: 0 });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail =
      (data && (data.detail || data.message)) ||
      (response.status === 404 ? 'That order was not found.' : 'The checkout refused this request.');
    throw new PaymentError(String(detail), { status: response.status, payload: data });
  }
  return data || {};
}

function methods() {
  return request('/api/payments/methods');
}

function createCheckout({ discordId, plan, method = null, donutUsername = null, giftCardBrand = null, giftCardCode = null, giftCardValue = null }) {
  return request('/api/discord/bot/checkout', {
    method: 'POST',
    body: {
      discord_id: discordId,
      plan_type: plan,
      method,
      donut_username: donutUsername,
      gift_card_brand: giftCardBrand,
      gift_card_code: giftCardCode,
      gift_card_value: giftCardValue,
    },
  });
}

function getOrder(uid, discordId) {
  return request(`/api/discord/bot/order/${encodeURIComponent(uid)}`, {
    query: { discord_id: discordId },
  });
}

function listMyOrders(discordId, limit = 10) {
  return request('/api/discord/bot/orders', { query: { discord_id: discordId, limit } });
}

function submitCrypto(uid, discordId, txid) {
  return request(`/api/discord/bot/order/${encodeURIComponent(uid)}/crypto`, {
    method: 'POST',
    body: { discord_id: discordId, txid },
  });
}

function staffQueue(status = 'all') {
  return request('/api/discord/bot/payments', { query: { status } });
}

function approve(uid, adminDiscordId) {
  return request(`/api/discord/bot/payments/${encodeURIComponent(uid)}/approve`, {
    method: 'POST',
    body: { admin_discord_id: adminDiscordId },
  });
}

function reject(uid, reason, adminDiscordId) {
  return request(`/api/discord/bot/payments/${encodeURIComponent(uid)}/reject`, {
    method: 'POST',
    body: { reason, admin_discord_id: adminDiscordId },
  });
}

module.exports = {
  PaymentError,
  configured,
  methods,
  createCheckout,
  getOrder,
  listMyOrders,
  submitCrypto,
  staffQueue,
  approve,
  reject,
};
