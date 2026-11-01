const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const { logTicketEvent } = require('../utils/ticketLog');

const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Post the support ticket panel in a channel')
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Where the panel should go (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

async function execute(interaction) {
  const config = getTicketConfig();
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff can post the ticket panel.', ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel?.isTextBased()) {
    return interaction.reply({ content: 'Pick a text channel.', ephemeral: true });
  }

  const types = config.types || [];
  if (!types.length) {
    return interaction.reply({
      content: 'No ticket categories are configured in `config/tickets.json`.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(config.panel.title)
    .setDescription(config.panel.description)
    .setColor(config.panel.color)
    .setFooter({ text: config.panel.footer || 'Champ Client Support' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket-select')
    .setPlaceholder(config.panel.placeholder || 'Choose a support category...')
    .addOptions(
      types.slice(0, 25).map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(type.label.slice(0, 100))
          .setValue(type.id)
          .setDescription(String(type.description || '').slice(0, 100) || undefined)
          .setEmoji(type.emoji || '🎫')
      )
    );

  const message = await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });

  await logTicketEvent(interaction.guild, config, {
    title: '🎫 Ticket panel posted',
    fields: [
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'By', value: interaction.user.tag, inline: true },
    ],
  });

  return interaction.reply({ content: `✅ Panel posted: ${message.url}`, ephemeral: true });
}

module.exports = { data, execute };
