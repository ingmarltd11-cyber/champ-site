const jsonStore = require('./jsonStore');
const { log } = require('./logger');

// Ticket data has two homes. With Supabase configured (and the table reachable) every ticket is a
// row, so the website and the bot see the same history. Otherwise the same records live in
// data/tickets.json. A missing/unreachable table falls back to JSON instead of breaking tickets.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);
const FILE = 'tickets.json';

let active = CONFIGURED;
let mode = CONFIGURED ? 'supabase' : 'json';

function isSupabaseActive() {
  return active;
}

function fromRow(row) {
  if (!row) return null;
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    userId: row.user_id,
    typeId: row.type_id,
    status: row.status || 'open',
    claimedBy: row.claimed_by || null,
    answers: row.answers || {},
    rating: row.rating ?? null,
    ratingComment: row.rating_comment || null,
    transcript: row.transcript || null,
    warned: Boolean(row.warned),
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    closedAt: row.closed_at || null,
  };
}

function toRow(ticket) {
  return {
    channel_id: ticket.channelId,
    guild_id: ticket.guildId,
    user_id: ticket.userId,
    type_id: ticket.typeId,
    status: ticket.status || 'open',
    claimed_by: ticket.claimedBy || null,
    answers: ticket.answers || {},
    rating: ticket.rating ?? null,
    rating_comment: ticket.ratingComment || null,
    transcript: ticket.transcript || null,
    warned: Boolean(ticket.warned),
    created_at: ticket.createdAt || new Date().toISOString(),
    last_activity_at: ticket.lastActivityAt || new Date().toISOString(),
    closed_at: ticket.closedAt || null,
  };
}

async function sb(pathname, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${pathname} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Called once at boot. A configured but unreachable table is a common launch mistake, so the bot
// logs exactly what is wrong and keeps working on the JSON store.
async function init() {
  if (!CONFIGURED) {
    active = false;
    mode = 'json';
    log.info('tickets', 'storage: data/tickets.json (Supabase is not configured)');
    return { mode };
  }
  try {
    await sb('tickets?select=channel_id&limit=1');
    active = true;
    mode = 'supabase';
    log.info('tickets', 'storage: Supabase (public.tickets)');
  } catch (err) {
    active = false;
    mode = 'json';
    log.error('tickets', `Supabase tickets unavailable, falling back to data/tickets.json: ${err.message}`);
    log.error('tickets', 'Apply website/discord bot/supabase/schema.sql in the Supabase SQL editor to enable it.');
  }
  return { mode };
}

async function addTicket(channelId, ticket) {
  const record = {
    channelId,
    status: 'open',
    claimedBy: null,
    answers: {},
    rating: null,
    warned: false,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...ticket,
  };
  if (active) {
    const rows = await sb('tickets?on_conflict=channel_id', {
      method: 'POST',
      body: toRow(record),
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return fromRow(rows?.[0]);
  }
  await jsonStore.updateJson(FILE, {}, (all) => {
    all[channelId] = record;
  });
  return record;
}

async function getTicket(channelId) {
  if (active) {
    const rows = await sb(`tickets?channel_id=eq.${encodeURIComponent(channelId)}&select=*&limit=1`);
    return fromRow(rows?.[0]);
  }
  const all = jsonStore.readJson(FILE, {});
  return all[channelId] || null;
}

async function patchTicket(channelId, patch) {
  const now = new Date().toISOString();
  if (active) {
    const columnMap = {
      claimedBy: 'claimed_by',
      ratingComment: 'rating_comment',
      lastActivityAt: 'last_activity_at',
      closedAt: 'closed_at',
    };
    const body = {};
    for (const [key, value] of Object.entries(patch)) body[columnMap[key] || key] = value;
    if (!('last_activity_at' in body)) body.last_activity_at = now;
    const rows = await sb(`tickets?channel_id=eq.${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body,
      prefer: 'return=representation',
    });
    return fromRow(rows?.[0]);
  }
  let updated = null;
  await jsonStore.updateJson(FILE, {}, (all) => {
    if (!all[channelId]) return;
    all[channelId] = { ...all[channelId], ...patch, lastActivityAt: now };
    updated = all[channelId];
  });
  return updated;
}

const claimTicket = (channelId, staffId) => patchTicket(channelId, { claimedBy: staffId });
const setWarned = (channelId) => patchTicket(channelId, { warned: true });

// A message in the ticket counts as activity. It also clears the inactivity warning, so a member
// who replies gets a fresh window instead of being closed straight after the first warning.
const touchTicket = (channelId) => patchTicket(channelId, { warned: false });
const setRating = (channelId, rating, ratingComment) => patchTicket(channelId, { rating, ratingComment });

async function closeTicket(channelId, { transcript } = {}) {
  return patchTicket(channelId, {
    status: 'closed',
    transcript: transcript || null,
    closedAt: new Date().toISOString(),
  });
}

async function allTickets() {
  if (active) {
    const rows = await sb('tickets?select=*');
    return (rows || []).map(fromRow);
  }
  return Object.values(jsonStore.readJson(FILE, {}));
}

async function countOpenByUser(userId) {
  if (active) {
    const rows = await sb(
      `tickets?user_id=eq.${encodeURIComponent(userId)}&status=eq.open&select=channel_id`
    );
    return (rows || []).length;
  }
  return Object.values(jsonStore.readJson(FILE, {})).filter(
    (t) => t.userId === userId && t.status === 'open'
  ).length;
}

async function listOpenTickets() {
  const tickets = await allTickets();
  return tickets.filter((t) => t.status === 'open').map((t) => ({ ...t, channelId: t.channelId }));
}

function withinDay(value, now) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && now - time <= 86400000;
}

async function getStats(now = Date.now()) {
  const tickets = await allTickets();
  const open = tickets.filter((t) => t.status === 'open');
  const closed = tickets.filter((t) => t.status === 'closed');
  const rated = tickets.filter((t) => Number.isFinite(Number(t.rating)) && t.rating !== null);
  const openByType = {};
  for (const t of open) openByType[t.typeId] = (openByType[t.typeId] || 0) + 1;
  const claims = {};
  for (const t of tickets) if (t.claimedBy) claims[t.claimedBy] = (claims[t.claimedBy] || 0) + 1;
  const average = rated.length
    ? rated.reduce((sum, t) => sum + Number(t.rating), 0) / rated.length
    : null;
  return {
    total: tickets.length,
    openTotal: open.length,
    closedTotal: closed.length,
    openedLast24h: tickets.filter((t) => withinDay(t.createdAt, now)).length,
    closedLast24h: tickets.filter((t) => withinDay(t.closedAt, now)).length,
    averageRating: average,
    avgRating: average,
    ratingsTotal: rated.length,
    openByType,
    topStaff: Object.entries(claims)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
}

module.exports = {
  init,
  isSupabaseActive,
  addTicket,
  getTicket,
  claimTicket,
  closeTicket,
  setRating,
  setWarned,
  touchTicket,
  countOpenByUser,
  listOpenTickets,
  getStats,
  // exported for the panel and tests
  __internal: { fromRow, toRow },
};
