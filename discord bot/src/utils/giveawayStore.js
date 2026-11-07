const crypto = require('crypto');
const jsonStore = require('./jsonStore');

// Giveaways live in data/giveaways.json. Every mutation goes through jsonStore.updateJson, so
// two people clicking Enter at the same moment cannot drop an entry.
const FILE = 'giveaways.json';

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function normalise(record) {
  return {
    ...record,
    winners: Math.max(1, Number(record.winners) || 1),
    minAccountAgeDays: Math.max(0, Number(record.minAccountAgeDays) || 0),
    entries: Array.isArray(record.entries) ? [...new Set(record.entries)] : [],
    entriesCount: Array.isArray(record.entries) ? new Set(record.entries).size : 0,
    winnerIds: Array.isArray(record.winnerIds) ? record.winnerIds : [],
    ended: Boolean(record.ended),
  };
}

async function createGiveaway(giveaway) {
  const record = normalise({
    id: newId(),
    createdAt: new Date().toISOString(),
    entries: [],
    winnerIds: [],
    ended: false,
    endedAt: null,
    endedBy: null,
    ...giveaway,
  });
  await jsonStore.updateJson(FILE, [], (all) => {
    all.push(record);
  });
  return record;
}

async function getGiveaway(id) {
  const all = jsonStore.readJson(FILE, []);
  const found = all.find((g) => g.id === id);
  return found ? normalise(found) : null;
}

async function updateGiveaway(id, patch) {
  let updated = null;
  await jsonStore.updateJson(FILE, [], (all) => {
    const index = all.findIndex((g) => g.id === id);
    if (index === -1) return;
    all[index] = normalise({ ...all[index], ...patch });
    updated = all[index];
  });
  return updated;
}

async function removeGiveaway(id) {
  let removed = null;
  await jsonStore.updateJson(FILE, [], (all) => {
    const index = all.findIndex((g) => g.id === id);
    if (index === -1) return;
    removed = all[index];
    all.splice(index, 1);
  });
  return removed;
}

async function listGiveaways({ guildId = null, activeOnly = false } = {}) {
  const all = jsonStore.readJson(FILE, []).map(normalise);
  return all.filter((g) => (!guildId || g.guildId === guildId) && (!activeOnly || !g.ended));
}

async function listDue(now = Date.now()) {
  const all = jsonStore.readJson(FILE, []).map(normalise);
  return all.filter((g) => {
    const endsAt = new Date(g.endsAt).getTime();
    return !g.ended && Number.isFinite(endsAt) && endsAt <= now;
  });
}

// Returns { added, giveaway, total }. `added: false` means the user was already in.
async function addEntry(id, userId) {
  let result = { added: false, giveaway: null, total: 0 };
  await jsonStore.updateJson(FILE, [], (all) => {
    const index = all.findIndex((g) => g.id === id);
    if (index === -1) return;
    const giveaway = normalise(all[index]);
    if (giveaway.ended) {
      result = { added: false, giveaway, total: giveaway.entries.length, ended: true };
      return;
    }
    if (!giveaway.entries.includes(userId)) {
      giveaway.entries.push(userId);
      result = { added: true, giveaway, total: giveaway.entries.length };
    } else {
      result = { added: false, giveaway, total: giveaway.entries.length };
    }
    all[index] = giveaway;
  });
  return result;
}

async function markEnded(id, { winnerIds = [], endedBy = null, endedAt = new Date().toISOString() } = {}) {
  return updateGiveaway(id, { ended: true, winnerIds, endedBy, endedAt });
}

module.exports = {
  FILE,
  createGiveaway,
  getGiveaway,
  updateGiveaway,
  removeGiveaway,
  listGiveaways,
  listDue,
  addEntry,
  markEnded,
};
