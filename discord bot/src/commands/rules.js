const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { requireStaff, botCan } = require('../utils/moderation');
const { siteUrl, truncate } = require('../utils/format');

const RULES_PATH = path.join(__dirname, '..', '..', 'config', 'rules.json');

const data = new SlashCommandBuilder()
  .setName('rules')
  .setDescription('Post the server rules (staff)')
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where to post them (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

// Read on every use so a rule can be edited in config/rules.json and reposted without a restart.
function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const rules = JSON.parse(raw);
  if (!rules || typeof rules !== 'object') throw new Error('rules.json must contain an object');
  if (!Array.isArray(rules.sections) || rules.sections.length === 0) {
    throw new Error('rules.json needs at least one section');
  }
  if (rules.sections.length > 25) throw new Error('Discord allows at most 25 rule sections');
  for (const [index, section] of rules.sections.entries()) {
    if (!section?.title || !section?.body) {
      throw new Error(`section ${index + 1} needs a title and a body`);
    }
    if (String(section.body).length > 1024) {
      throw new Error(`section ${index + 1} is longer than 1024 characters`);
    }
  }
  return rules;
}

async function execute(interaction) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  let rules;
  try {
    rules = loadRules();
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

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'CHAMP CLIENT', iconURL: `${siteUrl()}/assets/logo-teal.png` })
    .setTitle(truncate(rules.title || 'Server rules', 256))
    .setColor(rules.color || '#2EC4B6')
    .setTimestamp()
    .setFooter({ text: truncate(rules.footer || 'Champ Client', 2048) });

  if (rules.intro) embed.setDescription(truncate(rules.intro, 4096));
  embed.addFields(
    rules.sections.map((section) => ({
      name: truncate(section.title, 256),
      value: truncate(section.body, 1024),
    }))
  );

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (rules.showTermsButton !== false) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Terms of service')
          .setURL(`${siteUrl()}/terms.html`)
          .setStyle(ButtonStyle.Link)
      ),
    ];
  }

  const sent = await channel.send(payload);
  return interaction.editReply(`✅ Rules posted in ${channel}. [Jump to them](${sent.url})`);
}

module.exports = { data, execute, loadRules };
