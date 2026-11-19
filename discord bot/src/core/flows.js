// Multi-step clickGUI flows (choose a channel after typing a modal, confirm a payment plan,
// pick a moderation target) keep their draft here. State is deliberately short lived: the
// panels themselves are persisted, the half-finished wizard is not.
const TTL_MS = 15 * 60 * 1000;
const drafts = new Map();

function key(userId, flow) {
  return `${userId}:${flow}`;
}

function set(userId, flow, value) {
  drafts.set(key(userId, flow), { value, at: Date.now() });
  prune();
  return value;
}

function get(userId, flow) {
  const entry = drafts.get(key(userId, flow));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    drafts.delete(key(userId, flow));
    return null;
  }
  return entry.value;
}

function update(userId, flow, patch) {
  const current = get(userId, flow) || {};
  const next = { ...current, ...patch };
  set(userId, flow, next);
  return next;
}

function clear(userId, flow) {
  drafts.delete(key(userId, flow));
}

function prune(now = Date.now()) {
  for (const [entryKey, entry] of drafts) {
    if (now - entry.at > TTL_MS) drafts.delete(entryKey);
  }
}

module.exports = { TTL_MS, set, get, update, clear, prune };
