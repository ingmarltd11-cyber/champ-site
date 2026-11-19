const jsonStore = require('./jsonStore');
const { loadRules } = require('./rules');

// config/rules.json is the shipped copy; anything an admin edits from Discord is stored as an
// override in DATA_DIR/rules.json, so a restart or redeploy keeps the edited wording.
const FILE = 'rules.json';

function readOverrides() {
  const value = jsonStore.readJson(FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getRulesConfig() {
  return loadRules(readOverrides());
}

async function updateRulesConfig(patch) {
  const current = readOverrides();
  const next = { ...current, ...patch };
  await jsonStore.writeJson(FILE, next);
  return getRulesConfig();
}

async function resetRulesConfig() {
  await jsonStore.writeJson(FILE, {});
  return getRulesConfig();
}

module.exports = { FILE, getRulesConfig, updateRulesConfig, resetRulesConfig };
