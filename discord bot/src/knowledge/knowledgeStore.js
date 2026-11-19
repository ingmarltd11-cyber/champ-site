const jsonStore = require('../utils/jsonStore');

// The forum is the source of truth. This file is only a searchable index of its threads, kept
// in DATA_DIR so a restart can answer a search before Discord has been re-scanned.
const FILE = 'knowledge.json';
const EMPTY = { entries: {}, lastSyncAt: null };

function state() {
  const value = jsonStore.readJson(FILE, EMPTY);
  if (!value || typeof value !== 'object') return { ...EMPTY, entries: {} };
  return {
    entries: value.entries && typeof value.entries === 'object' ? value.entries : {},
    lastSyncAt: value.lastSyncAt || null,
  };
}

function normalise(entry) {
  return {
    threadId: String(entry.threadId),
    guildId: String(entry.guildId || ''),
    forumId: String(entry.forumId || ''),
    parentId: String(entry.parentId || entry.forumId || ''),
    title: String(entry.title || 'Untitled').slice(0, 200),
    body: String(entry.body || '').slice(0, 8000),
    tags: Array.isArray(entry.tags) ? [...new Set(entry.tags.map(String))] : [],
    authorId: entry.authorId ? String(entry.authorId) : null,
    authorName: entry.authorName ? String(entry.authorName) : null,
    messageId: entry.messageId ? String(entry.messageId) : null,
    url: entry.url ? String(entry.url) : null,
    archived: Boolean(entry.archived),
    locked: Boolean(entry.locked),
    pinned: Boolean(entry.pinned),
    messageCount: Math.max(0, Number(entry.messageCount) || 0),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
    lastActivityAt: entry.lastActivityAt || entry.updatedAt || new Date().toISOString(),
  };
}

async function upsertEntry(entry) {
  if (!entry?.threadId) throw new Error('knowledge entry needs a threadId');
  const record = normalise(entry);
  await jsonStore.updateJson(FILE, EMPTY, (all) => {
    if (!all.entries || typeof all.entries !== 'object') all.entries = {};
    const previous = all.entries[record.threadId] || {};
    all.entries[record.threadId] = { ...previous, ...record };
  });
  return record;
}

async function removeEntry(threadId) {
  let removed = null;
  await jsonStore.updateJson(FILE, EMPTY, (all) => {
    if (!all.entries) return;
    removed = all.entries[threadId] || null;
    delete all.entries[threadId];
  });
  return removed;
}

async function getEntry(threadId) {
  const entry = state().entries[String(threadId)];
  return entry ? normalise(entry) : null;
}

async function listEntries({ guildId = null, forumId = null, tag = null, includeArchived = false } = {}) {
  return Object.values(state().entries)
    .map(normalise)
    .filter(
      (entry) =>
        (!guildId || entry.guildId === guildId) &&
        (!forumId || entry.forumId === forumId) &&
        (!tag || entry.tags.includes(tag)) &&
        (includeArchived || !entry.archived)
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Titles win over bodies, exact words win over fragments, and a tag hit is a small boost.
// No index is needed at this size; a few hundred entries scan in well under a millisecond.
function scoreEntry(entry, tokens) {
  const title = entry.title.toLowerCase();
  const body = entry.body.toLowerCase();
  const tags = entry.tags.join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (title.includes(token)) score += 6;
    if (tags.includes(token)) score += 3;
    if (body.includes(token)) score += 1;
  }
  if (entry.pinned) score += 2;
  return score;
}

async function searchEntries(query, { guildId = null, forumId = null, tag = null, limit = 20 } = {}) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  const entries = await listEntries({ guildId, forumId, tag });
  if (!tokens.length) return entries.slice(0, limit);
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt)))
    .slice(0, limit)
    .map((item) => item.entry);
}

async function setLastSync(at = new Date().toISOString()) {
  await jsonStore.updateJson(FILE, EMPTY, (all) => {
    all.lastSyncAt = at;
    if (!all.entries) all.entries = {};
  });
  return at;
}

function meta() {
  const current = state();
  return { lastSyncAt: current.lastSyncAt, total: Object.keys(current.entries).length };
}

async function stats({ guildId = null } = {}) {
  const entries = await listEntries({ guildId, includeArchived: true });
  const byTag = {};
  for (const entry of entries) {
    for (const tag of entry.tags.length ? entry.tags : ['untagged']) {
      byTag[tag] = (byTag[tag] || 0) + 1;
    }
  }
  return {
    total: entries.length,
    published: entries.filter((entry) => !entry.archived).length,
    archived: entries.filter((entry) => entry.archived).length,
    byTag,
    lastSyncAt: meta().lastSyncAt,
  };
}

module.exports = {
  FILE,
  normalise,
  upsertEntry,
  removeEntry,
  getEntry,
  listEntries,
  searchEntries,
  setLastSync,
  meta,
  stats,
  scoreEntry,
};
