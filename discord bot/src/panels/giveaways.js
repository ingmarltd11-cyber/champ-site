const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const giveawayStore = require('../utils/giveawayStore');
const { getGiveawayConfig } = require('../config/loadConfig');
const { buildId } = require('../core/ids');

async function build(panel) {
  const config = getGiveawayConfig();
  const options = panel.options || {};
  const active = await giveawayStore
    .listGiveaways({ guildId: panel.guildId, activeOnly: true })
    .catch(() => []);

  const embed = new EmbedBuilder()
    .setTitle(options.title || '🎉 Champ giveaways')
    .setDescription(
      options.description ||
        'Press **Create giveaway** to start one, or **Active giveaways** to see what is running. Members enter with the button on each giveaway message.'
    )
    .setColor(options.color || config.defaultColor || '#FFC93C')
    .addFields({
      name: 'Running now',
      value: active.length ? String(active.length) : 'No active giveaways',
      inline: true,
    })
    .setFooter({ text: 'Champ Client · giveaways' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'giveaway-create'))
      .setLabel('Create giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'giveaway-list'))
      .setLabel('Active giveaways')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { build };
