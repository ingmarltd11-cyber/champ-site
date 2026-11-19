const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const { logTicketEvent } = require('../utils/ticketLog');
const panelStore = require('../core/panelStore');
const { postPanel } = require('../core/panelRuntime');

const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Post a support ticket panel in a channel')
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Where the panel should go (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addStringOption((opt) =>
    opt
      .setName('name')
      .setDescription('Panel name, for servers with several ticket panels')
      .setMaxLength(80)
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
  if (!(config.types || []).length) {
    return interaction.reply({
      content: 'No ticket categories are configured in `config/tickets.json`.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const panel = await panelStore.createPanel({
    guildId: interaction.guildId,
    type: 'tickets',
    name: interaction.options.getString('name') || 'Support tickets',
    channelId: channel.id,
    createdBy: interaction.user.id,
  });
  const message = await postPanel(interaction.client, panel);

  await logTicketEvent(interaction.guild, config, {
    title: '🎫 Ticket panel posted',
    fields: [
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'By', value: interaction.user.tag, inline: true },
    ],
  });

  return interaction.editReply({
    content: `✅ Panel posted: ${message.url}\nIt is stored and will refresh after a restart. Create more with \`/ticket-panel name:...\` or the control panel.`,
  });
}

module.exports = { data, execute };
