const jsonStore = require('./jsonStore');

// Ticket data has two homes. With Supabase configured every ticket is a row, so the website
// and the bot see the same history. Without it the bot keeps the same records in data/tickets.json.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const FILE = 'tickets.json';

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
  if (USE_SUPABASE) {
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
  if (USE_SUPABASE) {
    const rows = await sb(`tickets?channel_id=eq.${encodeURIComponent(channelId)}&select=*&limit=1`);
    return fromRow(rows?.[0]);
  }
  const all = jsonStore.readJson(FILE, {});
  return all[channelId] || null;
}

async function patchTicket(channelId, patch) {
  const fields = {
    ...patch,
    last_activity_at: new Date().toISOString(),
  };
  if (USE_SUPABASE) {
    const columnMap = {
      claimedBy: 'claimed_by',
      ratingComment: 'rating_comment',
      lastActivityAt: 'last_activity_at',
      closedAt: 'closed_at',
    };
    const body = {};
    for (const [key, value] of Object.entries(patch)) body[columnMap[key] || key] = value;
    if (!('last_activity_at' in body)) body.last_activity_at = fields.last_activity_at;
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
    all[channelId] = { ...all[channelId], ...patch, lastActivityAt: fields.last_activity_at };
    updated = all[channelId];
  });
  return updated;
}

const claimTicket = (channelId, staffId) => patchTicket(channelId, { claimedBy: staffId });
const setWarned = (channelId) => patchTicket(channelId, { warned: true });

// A message in the ticket counts as activity; the auto-close job reads lastActivityAt.
const touchTicket = (channelId) => patchTicket(channelId, {});
const setRating = (channelId, rating, ratingComment) => patchTicket(channelId, { rating, ratingComment });

async function closeTicket(channelId, { transcript } = {}) {
  return patchTicket(channelId, {
    status: 'closed',
    transcript: transcript || null,
    closedAt: new Date().toISOString(),
  });
}

async function allTickets() {
  if (USE_SUPABASE) {
    const rows = await sb('tickets?select=*');
    return (rows || []).map(fromRow);
  }
  return Object.values(jsonStore.readJson(FILE, {}));
}

async function countOpenByUser(userId) {
  if (USE_SUPABASE) {
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

async function getStats() {
  const tickets = await allTickets();
  const open = tickets.filter((t) => t.status === 'open');
  const closed = tickets.filter((t) => t.status === 'closed');
  const rated = tickets.filter((t) => Number.isFinite(Number(t.rating)) && t.rating !== null);
  const openByType = {};
  for (const t of open) openByType[t.typeId] = (openByType[t.typeId] || 0) + 1;
  const claims = {};
  for (const t of tickets) if (t.claimedBy) claims[t.claimedBy] = (claims[t.claimedBy] || 0) + 1;
  return {
    openTotal: open.length,
    closedTotal: closed.length,
    averageRating: rated.length
      ? rated.reduce((sum, t) => sum + Number(t.rating), 0) / rated.length
      : null,
    avgRating: rated.length
      ? rated.reduce((sum, t) => sum + Number(t.rating), 0) / rated.length
      : null,
    ratingsTotal: rated.length,
    openByType,
    topStaff: Object.entries(claims)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
}

module.exports = {
  USE_SUPABASE,
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
