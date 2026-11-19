const crypto = require('crypto');
const jsonStore = require('../utils/jsonStore');

// Every panel the bot has posted is a record, not a hard-coded message. That is what makes
// "multiple panels" real: a server can have several ticket panels (support, billing, media),
// a knowledge panel per channel, a payment panel, and so on. Records survive restarts and are
// re-rendered from the current config on every refresh.
const FILE = 'panels.json';
const TYPES = [
  'tickets',
  'giveaways',
  'knowledge',
  'payments',
  'rules',
  'welcome',
  'status',
  'help',
];

const TYPE_LABELS = {
  tickets: 'Ticket panel',
  giveaways: 'Giveaway panel',
  knowledge: 'Knowledge panel',
  payments: 'Payment panel',
  rules: 'Rules panel',
  welcome: 'Welcome panel',
  status: 'Status panel',
  help: 'Help panel',
};

function cleanOptions(options) {
  return options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
}

function normalise(record) {
  return {
    id: String(record.id || crypto.randomBytes(4).toString('hex')),
    guildId: String(record.guildId || ''),
    type: TYPES.includes(record.type) ? record.type : 'tickets',
    name: String(record.name || TYPE_LABELS[record.type] || 'Panel').slice(0, 80),
    channelId: String(record.channelId || ''),
    messageId: record.messageId ? String(record.messageId) : null,
    options: cleanOptions(record.options),
    createdBy: record.createdBy ? String(record.createdBy) : null,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

async function createPanel({ guildId, type, name, channelId, options = {}, createdBy = null }) {
  const record = normalise({
    id: crypto.randomBytes(4).toString('hex'),
    guildId,
    type,
    name,
    channelId,
    options,
    createdBy,
  });
  await jsonStore.updateJson(FILE, [], (all) => {
    all.push(record);
  });
  return record;
}

async function getPanel(id) {
  const all = jsonStore.readJson(FILE, []);
  const found = all.find((panel) => String(panel.id) === String(id));
  return found ? normalise(found) : null;
}

async function listPanels({ guildId = null, type = null } = {}) {
  return jsonStore
    .readJson(FILE, [])
    .map(normalise)
    .filter((panel) => (!guildId || panel.guildId === guildId) && (!type || panel.type === type))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function updatePanel(id, patch) {
  let updated = null;
  await jsonStore.updateJson(FILE, [], (all) => {
    const index = all.findIndex((panel) => String(panel.id) === String(id));
    if (index === -1) return;
    all[index] = normalise({ ...all[index], ...patch, updatedAt: new Date().toISOString() });
    updated = all[index];
  });
  return updated;
}

async function attachMessage(id, { channelId, messageId }) {
  return updatePanel(id, { channelId, messageId });
}

async function deletePanel(id) {
  let removed = null;
  await jsonStore.updateJson(FILE, [], (all) => {
    const index = all.findIndex((panel) => String(panel.id) === String(id));
    if (index === -1) return;
    removed = normalise(all[index]);
    all.splice(index, 1);
  });
  return removed;
}

// A panel message deleted by hand is re-posted instead of leaving a dead record behind.
async function forgetMessage(id) {
  return updatePanel(id, { messageId: null });
}

module.exports = {
  FILE,
  TYPES,
  TYPE_LABELS,
  createPanel,
  getPanel,
  listPanels,
  updatePanel,
  attachMessage,
  deletePanel,
  forgetMessage,
  normalise,
};
