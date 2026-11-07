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
const { isHttpUrl, siteUrl, truncate } = require('../utils/format');

const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Post a launch or update announcement (staff)')
  .addStringOption((o) => o.setName('title').setDescription('Headline').setRequired(true).setMaxLength(256))
  .addStringOption((o) =>
    o.setName('message').setDescription('Body. **bold**, *italic*, lists and links work.').setRequired(true).setMaxLength(4000)
  )
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where to post it (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addStringOption((o) =>
    o
      .setName('ping')
      .setDescription('Who to notify')
      .addChoices(
        { name: 'Nobody', value: 'none' },
        { name: '@here', value: 'here' },
        { name: '@everyone', value: 'everyone' }
      )
  )
  .addStringOption((o) => o.setName('image').setDescription('Image URL (https)'))
  .addStringOption((o) => o.setName('button_url').setDescription('Optional link button URL'))
  .addStringOption((o) => o.setName('button_label').setDescription('Button text, e.g. Download'));

async function execute(interaction) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  const channel =
    interaction.options.getChannel('channel') ||
    interaction.guild.channels.cache.get(interaction.channelId);
  if (!channel?.isTextBased()) {
    return interaction.editReply('❌ Pick a text channel for the announcement.');
  }
  if (!botCan(interaction.guild, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks)) {
    return interaction.editReply('❌ I need **Send Messages** and **Embed Links**.');
  }

  const image = interaction.options.getString('image');
  if (image && !isHttpUrl(image)) {
    return interaction.editReply('❌ The image must be a direct http(s) URL.');
  }

  const buttonUrl = interaction.options.getString('button_url');
  const buttonLabel = interaction.options.getString('button_label') || 'Open';
  if (buttonUrl && !isHttpUrl(buttonUrl)) {
    return interaction.editReply('❌ The button URL must start with http(s)://');
  }

  const ping = interaction.options.getString('ping') || 'none';
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'CHAMP CLIENT', iconURL: `${siteUrl()}/assets/logo-teal.png` })
    .setTitle(truncate(interaction.options.getString('title'), 256))
    .setDescription(interaction.options.getString('message'))
    .setColor('#2EC4B6')
    .setTimestamp()
    .setFooter({ text: `${interaction.guild.name} · announcement` });

  if (image) embed.setImage(image);

  const payload = {
    content: ping === 'none' ? undefined : ping === 'here' ? '@here' : '@everyone',
    embeds: [embed],
    allowedMentions:
      ping === 'none' ? { parse: [] } : { parse: ping === 'here' ? ['everyone'] : ['everyone'] },
  };

  if (buttonUrl) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(truncate(buttonLabel, 80)).setURL(buttonUrl).setStyle(ButtonStyle.Link)
      ),
    ];
  }

  const sent = await channel.send(payload);
  return interaction.editReply(`✅ Announcement posted in ${channel}. [Jump to it](${sent.url})`);
}

module.exports = { data, execute };
