const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getKnowledgeConfig } = require('../config/loadConfig');
const knowledgeStore = require('../knowledge/knowledgeStore');
const { buildId } = require('../core/ids');

async function build(panel) {
  const config = getKnowledgeConfig();
  const options = panel.options || {};
  const forumId = options.forumChannelId || config.forumChannelId;
  const stats = await knowledgeStore.stats({ guildId: panel.guildId }).catch(() => ({ total: 0, published: 0 }));

  const embed = new EmbedBuilder()
    .setTitle(options.title || config.title || '📚 Knowledge base')
    .setDescription(
      options.description ||
        config.description ||
        'Browse guides, search for an answer, or ask a question in the forum.'
    )
    .setColor(options.color || config.color || '#2EC4B6')
    .addFields(
      { name: 'Entries', value: String(stats.total || 0), inline: true },
      { name: 'Forum', value: forumId ? `<#${forumId}>` : 'not configured yet', inline: true }
    )
    .setFooter({ text: 'Champ Client · knowledge' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'kb-browse'))
      .setLabel('Browse')
      .setEmoji('📚')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'kb-search'))
      .setLabel('Search')
      .setEmoji('🔎')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'kb-ask'))
      .setLabel('Ask a question')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'kb-refresh'))
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  const components = [row];
  if (forumId) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open the forum')
          .setURL(`https://discord.com/channels/${panel.guildId}/${forumId}`)
          .setStyle(ButtonStyle.Link)
      )
    );
  }

  return { embeds: [embed], components };
}

module.exports = { build };
