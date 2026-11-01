const jsonStore = require('./jsonStore');
const { getWelcomeDefaults } = require('../config/loadConfig');

// config/welcome.json holds the shipped defaults; data/welcome.json holds whatever an admin
// changes from Discord, merged on top. Restarting the bot keeps the overrides.
const OVERRIDES_FILE = 'welcome.json';

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

function getWelcomeConfig() {
  const defaults = getWelcomeDefaults();
  const overrides = jsonStore.readJson(OVERRIDES_FILE, {});
  return merge(defaults, overrides);
}

async function updateWelcomeConfig(patch) {
  const overrides = jsonStore.readJson(OVERRIDES_FILE, {});
  const next = merge(overrides, patch);
  await jsonStore.writeJson(OVERRIDES_FILE, next);
  return getWelcomeConfig();
}

async function resetWelcomeConfig() {
  await jsonStore.writeJson(OVERRIDES_FILE, {});
  return getWelcomeConfig();
}

module.exports = { getWelcomeConfig, updateWelcomeConfig, resetWelcomeConfig, merge };
