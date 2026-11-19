const jsonStore = require('../utils/jsonStore');

// The control panel is one message per server. Keeping its channel/message id lets the bot edit
// it on restart instead of posting a duplicate every deploy.
const FILE = 'control.json';

function list() {
  const value = jsonStore.readJson(FILE, {});
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([guildId, record]) => ({ guildId, ...record }));
}

function get(guildId) {
  return list().find((record) => record.guildId === String(guildId)) || null;
}

async function save(guildId, { channelId, messageId }) {
  await jsonStore.updateJson(FILE, {}, (all) => {
    all[String(guildId)] = { channelId: String(channelId), messageId: String(messageId), updatedAt: new Date().toISOString() };
  });
  return get(guildId);
}

async function remove(guildId) {
  await jsonStore.updateJson(FILE, {}, (all) => {
    delete all[String(guildId)];
  });
}

module.exports = { FILE, list, get, save, remove };
