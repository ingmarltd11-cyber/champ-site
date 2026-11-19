const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { requireStaff } = require('../utils/moderation');
const { postControlPanel } = require('../core/controlPanel');

const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Post the Champ control panel, where every feature is a button (staff)')
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Where to post it (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

async function execute(interaction) {
  if (!requireStaff(interaction)) return;
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel?.isTextBased()) {
    return interaction.reply({ content: '❌ Pick a text channel.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const message = await postControlPanel(channel, interaction.client);
    return interaction.editReply({
      content: `✅ Control panel posted in ${channel}: ${message.url}\nEverything (panels, tickets, giveaways, welcome, rules, announcements, moderation, knowledge and payments) is available from its menus.`,
    });
  } catch (err) {
    return interaction.editReply({ content: `❌ ${err.message}` });
  }
}

module.exports = { data, execute };
