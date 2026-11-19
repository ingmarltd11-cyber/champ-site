// Discord caps custom ids at 100 characters. Every interactive component in the bot is
// namespaced as `scope:action:argument...` and built here, so one router can dispatch them
// and a restart never invalidates a panel (the ids are derived from stored records).
const MAX_ID = 100;

function safe(value) {
  const text = String(value ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return text.slice(0, 48) || 'x';
}

function buildId(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(safe)
    .join(':')
    .slice(0, MAX_ID);
}

function parseId(customId) {
  return String(customId || '').split(':');
}

function isId(customId, scope) {
  return parseId(customId)[0] === scope;
}

module.exports = { MAX_ID, safe, buildId, parseId, isId };
