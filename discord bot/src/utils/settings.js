const jsonStore = require('./jsonStore');
const { getTicketConfig, getKnowledgeConfig } = require('../config/loadConfig');

// config/*.json is the shipped default. Edits made in the Discord clickGUI are stored as
// overrides in DATA_DIR, merged on top, so a redeploy never wipes a server's setup.
const TICKET_FILE = 'ticket-settings.json';
const KNOWLEDGE_FILE = 'knowledge-settings.json';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, override) {
  if (!isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(base?.[key]) ? merge(base[key], value) : value;
  }
  return out;
}

async function save(file, patch, getter) {
  const overrides = jsonStore.readJson(file, {});
  const next = merge(overrides, patch);
  await jsonStore.writeJson(file, next);
  return getter();
}

async function updateTicketSettings(patch) {
  return save(TICKET_FILE, patch, getTicketConfig);
}

async function resetTicketSettings() {
  await jsonStore.writeJson(TICKET_FILE, {});
  return getTicketConfig();
}

async function updateKnowledgeSettings(patch) {
  return save(KNOWLEDGE_FILE, patch, getKnowledgeConfig);
}

async function resetKnowledgeSettings() {
  await jsonStore.writeJson(KNOWLEDGE_FILE, {});
  return getKnowledgeConfig();
}

module.exports = {
  TICKET_FILE,
  KNOWLEDGE_FILE,
  merge,
  updateTicketSettings,
  resetTicketSettings,
  updateKnowledgeSettings,
  resetKnowledgeSettings,
};
