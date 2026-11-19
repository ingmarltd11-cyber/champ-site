const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getKnowledgeConfig, getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const knowledgeStore = require('../knowledge/knowledgeStore');
const { createThread, syncForum } = require('../knowledge/knowledgeSync');
const { buildId, parseId } = require('../core/ids');
const { log } = require('../utils/logger');

const MAX_SELECT = 25;

function tagLabel(config, id) {
  const tag = (config.tags || []).find((candidate) => candidate.id === id);
  return tag ? `${tag.emoji || ''} ${tag.label || tag.id}`.trim() : id;
}

function tagSummary(config, tags) {
  return tags?.length ? tags.map((tag) => tagLabel(config, tag)).join(' · ') : 'untagged';
}

function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function entrySelect(config, entries, panelId, tag) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(buildId('kb', 'entry', panelId))
      .setPlaceholder('Open a knowledge entry...')
      .addOptions(
        entries.slice(0, MAX_SELECT).map((entry) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(clip(entry.title, 100))
            .setValue(entry.threadId)
            .setDescription(
              clip(
                `${entry.tags.length ? entry.tags.map((id) => tagLabel(config, id)).join(', ') : 'Untagged'} · ${new Date(
                  entry.updatedAt
                ).toLocaleDateString('en-GB')}`,
                100
              )
            )
        )
      )
  );
}

function filterSelect(config, entries, panelId, activeTag) {
  const counts = {};
  for (const entry of entries) for (const tag of entry.tags.length ? entry.tags : ['untagged']) counts[tag] = (counts[tag] || 0) + 1;
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel(`All entries (${entries.length})`)
      .setValue('all')
      .setEmoji('📚')
      .setDefault(!activeTag || activeTag === 'all'),
    ...(config.tags || []).slice(0, MAX_SELECT - 1).map((tag) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(clip(`${tag.label || tag.id}${counts[tag.id] ? ` (${counts[tag.id]})` : ''}`, 100))
        .setValue(tag.id)
        .setEmoji(tag.emoji || '🏷️')
        .setDefault(activeTag === tag.id)
    ),
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(buildId('kb', 'tag', panelId))
      .setPlaceholder('Filter by tag...')
      .addOptions(options)
  );
}

function navRow(panelId, { ask = true, refresh = true } = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('kb', 'browse', panelId))
      .setLabel('Refresh list')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('kb', 'search', panelId))
      .setLabel('Search')
      .setEmoji('🔎')
      .setStyle(ButtonStyle.Primary)
  );
  if (ask) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('kb', 'ask', panelId))
        .setLabel('Ask a question')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Success)
    );
  }
  if (refresh) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('kb', 'sync', panelId))
        .setLabel('Sync forum')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

async function browsePayload(interaction, panelId, tag = 'all', { update = false } = {}) {
  const config = getKnowledgeConfig();
  const all = await knowledgeStore.listEntries({
    guildId: interaction.guildId,
    forumId: config.forumChannelId || null,
    includeArchived: true,
  });
  const filtered = tag && tag !== 'all' ? all.filter((entry) => entry.tags.includes(tag)) : all;
  const open = filtered.filter((entry) => !entry.archived);

  const embed = new EmbedBuilder()
    .setTitle('📚 Knowledge base')
    .setColor(config.color || '#2EC4B6')
    .setDescription(
      open.length
        ? 'Pick an entry below. Entries are forum threads, so the full conversation and screenshots stay attached.'
        : config.forumChannelId
          ? 'There are no indexed entries yet. Press **Sync forum** to import the threads.'
          : 'The knowledge forum is not configured yet. Staff can set it with **Control panel → Knowledge → Forum**.'
    )
    .setFooter({ text: `${filtered.length} entries · ${tag === 'all' ? 'all tags' : tagLabel(config, tag)}` });

  const components = [];
  if (all.length) components.push(filterSelect(config, all, panelId, tag));
  if (open.length) components.push(entrySelect(config, open, panelId, tag));
  components.push(navRow(panelId, { ask: config.allowPublicQuestions !== false }));

  const payload = { embeds: [embed], components };
  if (update) return interaction.update(payload).catch(() => {});
  return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
}

function entryPayload(entry, panelId) {
  const config = getKnowledgeConfig();
  const embed = new EmbedBuilder()
    .setTitle(clip(entry.title, 256))
    .setColor(config.color || '#2EC4B6')
    .setDescription(clip(entry.body || 'This entry has no text in its starter post. Open the thread to read it.', 4000))
    .addFields(
      { name: 'Tags', value: tagSummary(config, entry.tags), inline: true },
      { name: 'Author', value: entry.authorName ? `@${entry.authorName}` : 'unknown', inline: true },
      {
        name: 'Messages',
        value: String(entry.messageCount || 1),
        inline: true,
      }
    )
    .setFooter({
      text: `${entry.archived ? 'Archived' : 'Published'} · updated ${new Date(entry.updatedAt).toLocaleString('en-GB')}`,
    });
  if (entry.url) embed.setURL(entry.url);

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('kb', 'browse', panelId))
        .setLabel('Back to list')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('Open thread')
        .setURL(entry.url || `https://discord.com/channels/${entry.guildId}/${entry.threadId}`)
        .setStyle(ButtonStyle.Link)
    ),
  ];

  return { embeds: [embed], components, ephemeral: true };
}

async function showSearchModal(interaction, panelId) {
  const modal = new ModalBuilder()
    .setCustomId(buildId('kb', 'search-modal', panelId))
    .setTitle('Search the knowledge base');
  const input = new TextInputBuilder()
    .setCustomId('query')
    .setLabel('Words to search for')
    .setPlaceholder('e.g. injector closes, hwid reset, billing')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function showAskModal(interaction, panelId) {
  const config = getKnowledgeConfig();
  if (config.allowPublicQuestions === false) {
    return interaction.reply({ content: 'Questions are closed right now. Open a ticket instead.', ephemeral: true });
  }
  const modal = new ModalBuilder()
    .setCustomId(buildId('kb', 'ask-modal', panelId))
    .setTitle('Ask the knowledge base');
  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Short question')
    .setPlaceholder('e.g. How do I reset my HWID?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Details')
    .setPlaceholder('What did you try, and what happens?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1800);
  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(body)
  );
  await interaction.showModal(modal);
}

async function submitSearch(interaction, panelId) {
  const config = getKnowledgeConfig();
  const query = interaction.fields.getTextInputValue('query');
  const results = await knowledgeStore.searchEntries(query, {
    guildId: interaction.guildId,
    forumId: config.forumChannelId || null,
    limit: MAX_SELECT,
  });

  const embed = new EmbedBuilder()
    .setTitle(`🔎 Results for “${clip(query, 80)}”`)
    .setColor(config.color || '#2EC4B6')
    .setDescription(
      results.length
        ? results
            .slice(0, 10)
            .map((entry, index) => `${index + 1}. **${clip(entry.title, 90)}** — ${tagSummary(config, entry.tags)}`)
            .join('\n')
        : 'No matching entries. Try fewer words, or ask a question so the team can answer it in the forum.'
    )
    .setFooter({ text: `${results.length} match(es)` });

  const components = [];
  if (results.length) {
    components.push(entrySelect(config, results, panelId, 'all'));
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('kb', 'browse', panelId))
        .setLabel('Browse all')
        .setEmoji('📚')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildId('kb', 'ask', panelId))
        .setLabel('Ask a question')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Success)
    )
  );

  return interaction.reply({ embeds: [embed], components, ephemeral: true });
}

async function submitQuestion(interaction, panelId) {
  const config = getKnowledgeConfig();
  const title = interaction.fields.getTextInputValue('title');
  const body = interaction.fields.getTextInputValue('body');
  await interaction.deferReply({ ephemeral: true });
  try {
    const { thread } = await createThread(interaction.guild, {
      title,
      body: `${body}\n\n— asked by ${interaction.user} from the knowledge panel`,
      tag: config.questionTagId || 'question',
      authorId: interaction.user.id,
    });
    return interaction.editReply({
      content: `💬 Your question is live in the forum: ${thread}. Staff will answer there, and the thread becomes a searchable entry.`,
    });
  } catch (err) {
    log.warn('knowledge', `could not create a question thread: ${err.message}`);
    return interaction.editReply(`❌ ${err.message}`);
  }
}

async function syncNow(interaction) {
  if (!isStaffMember(interaction.member, interaction.guild, getTicketConfig())) {
    return interaction.reply({ content: '❌ Only staff can re-index the forum.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const result = await syncForum(interaction.guild);
  const message = result.reason
    ? `❌ ${result.reason}. Set the forum channel in **Control panel → Knowledge → Forum**.`
    : `✅ Indexed **${result.synced}** thread(s). Search and browse are up to date.`;
  return interaction.editReply({ content: message }).catch(() => {});
}

async function handleKnowledge(interaction) {
  const parts = parseId(interaction.customId);
  const [scope, action, panelId] = parts;

  if (scope === 'panel' && String(parts[2] || '').startsWith('kb-')) {
    const panelRef = parts[1];
    const sub = parts[2];
    if (sub === 'kb-browse') return browsePayload(interaction, panelRef);
    if (sub === 'kb-search') return showSearchModal(interaction, panelRef);
    if (sub === 'kb-ask') return showAskModal(interaction, panelRef);
    if (sub === 'kb-refresh' || sub === 'kb-sync') return syncNow(interaction);
    return false;
  }

  if (scope !== 'kb') return false;

  if (action === 'browse' && interaction.isButton()) {
    return browsePayload(interaction, panelId, 'all', { update: true });
  }
  if (action === 'tag' && interaction.isStringSelectMenu()) {
    return browsePayload(interaction, panelId, interaction.values[0] || 'all', { update: true });
  }
  if (action === 'entry' && interaction.isStringSelectMenu()) {
    const entry = await knowledgeStore.getEntry(interaction.values[0]);
    if (!entry) {
      return interaction.reply({ content: 'That entry is no longer indexed.', ephemeral: true });
    }
    return interaction.update(entryPayload(entry, panelId));
  }
  if (action === 'search' && interaction.isButton()) {
    return showSearchModal(interaction, panelId);
  }
  if (action === 'ask' && interaction.isButton()) {
    return showAskModal(interaction, panelId);
  }
  if (action === 'sync' && interaction.isButton()) {
    return syncNow(interaction);
  }
  if (action === 'search-modal' && interaction.isModalSubmit()) {
    return submitSearch(interaction, panelId);
  }
  if (action === 'ask-modal' && interaction.isModalSubmit()) {
    return submitQuestion(interaction, panelId);
  }

  return false;
}

module.exports = {
  handleKnowledge,
  browsePayload,
  entryPayload,
  tagLabel,
  tagSummary,
  showSearchModal,
  showAskModal,
};
