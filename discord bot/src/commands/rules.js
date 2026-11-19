const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { requireStaff, botCan } = require('../utils/moderation');
const { getRulesConfig } = require('../utils/ruleSettings');
const { buildRulesPayload, loadRules } = require('../utils/rules');

const data = new SlashCommandBuilder()
  .setName('rules')
  .setDescription('Post the server rules (staff)')
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where to post them (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

async function execute(interaction) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  let rules;
  try {
    rules = getRulesConfig();
  } catch (err) {
    return interaction.editReply(`❌ \`config/rules.json\`: ${err.message}`);
  }

  const channel =
    interaction.options.getChannel('channel') ||
    interaction.guild.channels.cache.get(interaction.channelId);
  if (!channel?.isTextBased()) {
    return interaction.editReply('❌ Pick a text channel for the rules.');
  }
  if (!botCan(interaction.guild, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks)) {
    return interaction.editReply('❌ I need **Send Messages** and **Embed Links**.');
  }

  const sent = await channel.send(buildRulesPayload(rules));
  return interaction.editReply(`✅ Rules posted in ${channel}. [Jump to them](${sent.url})`);
}

module.exports = { data, execute, loadRules };
