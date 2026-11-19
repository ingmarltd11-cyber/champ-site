const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { requireStaff } = require('../utils/moderation');
const { showPlans } = require('../handlers/paymentInteractions');
const panelStore = require('../core/panelStore');
const { postPanel } = require('../core/panelRuntime');

const data = new SlashCommandBuilder()
  .setName('payments')
  .setDescription('Buy Champ inside Discord, or post the payment panel (staff)')
  .addChannelOption((option) =>
    option
      .setName('panel')
      .setDescription('Post a persistent payment panel in this channel (staff)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

async function execute(interaction) {
  const channel = interaction.options.getChannel('panel');
  if (!channel) return showPlans(interaction);
  if (!requireStaff(interaction)) return;
  if (!channel.isTextBased()) {
    return interaction.reply({ content: '❌ Pick a text channel.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const panel = await panelStore.createPanel({
    guildId: interaction.guildId,
    type: 'payments',
    name: 'Champ checkout',
    channelId: channel.id,
    createdBy: interaction.user.id,
  });
  const message = await postPanel(interaction.client, panel);
  return interaction.editReply({ content: `✅ Payment panel posted in ${channel}: ${message.url}` });
}

module.exports = { data, execute };
