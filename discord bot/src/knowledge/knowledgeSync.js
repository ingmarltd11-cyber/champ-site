const { ChannelType } = require('discord.js');
const { getKnowledgeConfig } = require('../config/loadConfig');
const knowledgeStore = require('./knowledgeStore');
const { log } = require('../utils/logger');

// The configured forum is the knowledge editor. Every thread in it is indexed here; there is
// intentionally no `/knowledge add` command. Staff write a forum post (or use the panel's Ask
// button), tags decide the category, and the browse/search panels read the index.

function normaliseTagName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function tagMaps(forum, config) {
  const byLogical = new Map();
  const byDiscord = new Map();
  const available = Array.isArray(forum?.availableTags) ? forum.availableTags : [];
  for (const tag of config.tags || []) {
    const match =
      available.find((candidate) => candidate.id === tag.discordTagId) ||
      available.find((candidate) => normaliseTagName(candidate.name) === normaliseTagName(tag.label)) ||
      available.find((candidate) => normaliseTagName(candidate.name) === normaliseTagName(tag.id));
    if (match) {
      byLogical.set(tag.id, match.id);
      byDiscord.set(match.id, tag.id);
    }
  }
  return { byLogical, byDiscord };
}

function logicalTags(appliedTags, maps) {
  const ids = (appliedTags || []).map((id) => maps.byDiscord.get(id)).filter(Boolean);
  return [...new Set(ids)];
}

// A forum tag that exists in config but not in Discord is added to the channel when the bot has
// Manage Channels. Failing that, threads still sync; they simply have no tag on them.
async function ensureForumTags(forum, config) {
  if (!forum || forum.type !== ChannelType.GuildForum) return forum;
  const existing = Array.isArray(forum.availableTags) ? forum.availableTags : [];
  const missing = (config.tags || []).filter(
    (tag) =>
      !existing.some((candidate) => normaliseTagName(candidate.name) === normaliseTagName(tag.label))
  );
  if (!missing.length) return forum;
  if (existing.length + missing.length > 20) {
    log.warn('knowledge', 'forum already has 20 tags; some configured knowledge tags were not added');
    return forum;
  }
  try {
    const next = [
      ...existing.map((tag) => ({
        id: tag.id,
        name: tag.name,
        moderated: Boolean(tag.moderated),
        ...(tag.emoji ? { emoji: tag.emoji } : {}),
      })),
      ...missing.map((tag) => ({ name: String(tag.label).slice(0, 20), moderated: false })),
    ];
    await forum.setAvailableTags(next);
    return (await forum.fetch().catch(() => forum)) || forum;
  } catch (err) {
    log.warn('knowledge', `could not add forum tags: ${err.message}`);
    return forum;
  }
}

function isKnowledgeThread(thread, config = getKnowledgeConfig()) {
  return Boolean(
    thread &&
      thread.parentId &&
      config.forumChannelId &&
      String(thread.parentId) === String(config.forumChannelId)
  );
}

async function starterMessage(thread) {
  try {
    if (typeof thread.fetchStarterMessage === 'function') {
      const message = await thread.fetchStarterMessage({ force: true });
      if (message) return message;
    }
  } catch {
    /* fall through to the forum message lookup */
  }
  try {
    const channel = thread.guild?.channels?.cache?.get?.(thread.parentId);
    return await channel?.messages?.fetch?.(thread.id);
  } catch {
    return null;
  }
}

async function entryFromThread(thread, config = getKnowledgeConfig()) {
  const message = await starterMessage(thread);
  const forum = thread.guild?.channels?.cache?.get?.(thread.parentId) || thread.parent;
  const maps = tagMaps(forum, config);
  return {
    threadId: thread.id,
    guildId: thread.guildId || thread.guild?.id || '',
    forumId: thread.parentId || '',
    parentId: thread.parentId || '',
    title: thread.name || message?.content?.slice(0, 80) || 'Untitled entry',
    body: message?.content || '',
    tags: logicalTags(thread.appliedTags, maps),
    authorId: message?.author?.id || null,
    authorName: message?.author?.username || null,
    messageId: message?.id || thread.id,
    url: `https://discord.com/channels/${thread.guildId || thread.guild?.id}/${thread.id}`,
    archived: Boolean(thread.archived),
    locked: Boolean(thread.locked),
    pinned: Boolean(thread.pinned),
    messageCount: Math.max(1, Number(thread.messageCount) || 1),
    createdAt: (message?.createdAt || thread.createdAt || new Date()).toISOString?.() || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: (
      thread.lastMessageAt ||
      message?.createdAt ||
      thread.createdAt ||
      new Date()
    ).toISOString?.() || new Date().toISOString(),
  };
}

async function syncThread(thread, config = getKnowledgeConfig()) {
  if (!isKnowledgeThread(thread, config)) return null;
  try {
    const entry = await entryFromThread(thread, config);
    return await knowledgeStore.upsertEntry(entry);
  } catch (err) {
    log.warn('knowledge', `could not index thread ${thread.id}: ${err.message}`);
    return null;
  }
}

async function syncForum(guild, { config = getKnowledgeConfig(), limit = 200 } = {}) {
  if (!guild) return { synced: 0, reason: 'no guild' };
  const forumId = config.forumChannelId;
  if (!forumId || String(forumId).includes('_ID')) return { synced: 0, reason: 'forum not configured' };
  const forum = guild.channels.cache.get(forumId) || (await guild.channels.fetch(forumId).catch(() => null));
  if (!forum || forum.type !== ChannelType.GuildForum) {
    return { synced: 0, reason: 'forum channel missing or not a forum' };
  }

  const ready = await ensureForumTags(forum, config);
  const threads = new Map();
  try {
    const active = await ready.threads.fetchActive();
    for (const thread of active.threads.values()) threads.set(thread.id, thread);
  } catch (err) {
    log.warn('knowledge', `could not list active threads: ${err.message}`);
  }

  if (config.syncArchived !== false) {
    try {
      const archived = await ready.threads.fetchArchived({ limit: Math.min(100, limit) });
      for (const thread of archived.threads.values()) threads.set(thread.id, thread);
    } catch (err) {
      log.warn('knowledge', `could not list archived threads: ${err.message}`);
    }
  }

  let synced = 0;
  for (const thread of threads.values()) {
    if (synced >= limit) break;
    if (await syncThread(thread, config)) synced += 1;
  }
  await knowledgeStore.setLastSync();
  log.info('knowledge', `indexed ${synced} forum thread(s) from #${ready.name}`);
  return { synced, total: threads.size, forumId: ready.id };
}

async function createThread(guild, { title, body, tag = null, authorId = null } = {}) {
  const config = getKnowledgeConfig();
  const forumId = config.forumChannelId;
  if (!forumId) throw new Error('The knowledge forum is not configured yet. Staff can set it in the control panel.');
  const forum = guild.channels.cache.get(forumId) || (await guild.channels.fetch(forumId).catch(() => null));
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error('The configured knowledge channel is missing or is not a forum.');
  }
  const ready = await ensureForumTags(forum, config);
  const maps = tagMaps(ready, config);
  const logical = tag || config.questionTagId || 'question';
  const discordTag = maps.byLogical.get(logical);

  const thread = await ready.threads.create({
    name: String(title || 'New question').slice(0, 100),
    autoArchiveDuration: 10080,
    message: { content: String(body || 'No details provided.').slice(0, 2000) },
    ...(discordTag ? { appliedTags: [discordTag] } : {}),
    reason: authorId ? `Knowledge thread opened by ${authorId}` : 'Knowledge thread opened from the panel',
  });

  await syncThread(thread, config);
  return { thread, forum: ready };
}

function registerKnowledgeEvents(client) {
  client.on('threadCreate', (thread) => {
    syncThread(thread).catch((err) => log.warn('knowledge', `threadCreate sync failed: ${err.message}`));
  });

  client.on('threadUpdate', (_oldThread, newThread) => {
    syncThread(newThread).catch((err) => log.warn('knowledge', `threadUpdate sync failed: ${err.message}`));
  });

  client.on('threadDelete', (thread) => {
    const config = getKnowledgeConfig();
    if (!thread?.parentId || String(thread.parentId) !== String(config.forumChannelId)) return;
    knowledgeStore
      .removeEntry(thread.id)
      .catch((err) => log.warn('knowledge', `could not remove deleted thread: ${err.message}`));
  });

  client.on('messageCreate', (message) => {
    if (!message.guild || message.author?.bot) return;
    const config = getKnowledgeConfig();
    if (!message.channel?.isThread?.() || !message.channel.parentId) return;
    if (String(message.channel.parentId) !== String(config.forumChannelId)) return;
    // Any reply in a knowledge thread is activity. The starter post stays the indexed body;
    // the browse view links to the thread where the full conversation lives.
    knowledgeStore
      .getEntry(message.channel.id)
      .then((entry) => {
        if (!entry) return syncThread(message.channel, config);
        return knowledgeStore.upsertEntry({
          ...entry,
          messageCount: Math.max(entry.messageCount, Number(message.channel.messageCount) || 0),
          lastActivityAt: new Date().toISOString(),
          archived: Boolean(message.channel.archived),
        });
      })
      .catch((err) => log.warn('knowledge', `message sync failed: ${err.message}`));
  });
}

module.exports = {
  normaliseTagName,
  tagMaps,
  logicalTags,
  ensureForumTags,
  isKnowledgeThread,
  entryFromThread,
  syncThread,
  syncForum,
  createThread,
  registerKnowledgeEvents,
};
