const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { buildId } = require('../core/ids');

// A panel record can narrow the categories and change its own copy, so a server can run a
// general support panel next to a billing-only or media-only panel from the same config.
function build(panel) {
  const config = getTicketConfig();
  const options = panel.options || {};
  const only = Array.isArray(options.typeIds) && options.typeIds.length ? options.typeIds : null;
  const types = (config.types || []).filter((type) => !only || only.includes(type.id)).slice(0, 25);

  const embed = new EmbedBuilder()
    .setTitle(options.title || config.panel.title || 'Champ Support')
    .setDescription(options.description || config.panel.description || 'Choose a support category below.')
    .setColor(options.color || config.panel.color || '#FFC93C')
    .setFooter({ text: options.footer || config.panel.footer || 'Champ Client Support' });

  if (!types.length) {
    embed.setDescription('No ticket categories are configured for this panel yet.');
    return { embeds: [embed], components: [] };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId('panel', panel.id, 'ticket'))
    .setPlaceholder(options.placeholder || config.panel.placeholder || 'Choose a support category...')
    .addOptions(
      types.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(String(type.label).slice(0, 100))
          .setValue(type.id)
          .setDescription(String(type.description || '').slice(0, 100) || undefined)
          .setEmoji(type.emoji || '🎫')
      )
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = { build };
