const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const giveawayStore = require('../utils/giveawayStore');
const { getGiveawayConfig } = require('../config/loadConfig');
const { giveawayEmbedData, formatDuration } = require('../utils/giveaway');
const { endGiveaway, rerollGiveaway, entryRow, embed, isManager } = require('../handlers/giveawayInteractions');

function canManage(member) {
  const config = getGiveawayConfig();
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return (config.managerRoleIds || []).some((id) => member?.roles?.cache?.has(id));
}

const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Create and manage giveaways')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Start a new giveaway')
      .addStringOption((opt) =>
        opt.setName('prize').setDescription('What can be won?').setRequired(true).setMaxLength(200)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('minutes')
          .setDescription('How long the giveaway runs (minutes)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(20160)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('winners')
          .setDescription('Number of winners (default 1)')
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post in (default: here)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Extra text above the entry button').setMaxLength(1000)
      )
      .addRoleOption((opt) => opt.setName('required_role').setDescription('Only this role can enter'))
      .addIntegerOption((opt) =>
        opt
          .setName('min_account_age_days')
          .setDescription('Minimum Discord account age in days')
          .setMinValue(0)
          .setMaxValue(365)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('end')
      .setDescription('End a giveaway now and draw the winners')
      .addStringOption((opt) => opt.setName('id').setDescription('Giveaway ID (default: newest active)'))
  )
  .addSubcommand((sub) =>
    sub
      .setName('reroll')
      .setDescription('Draw a new winner for an ended giveaway')
      .addStringOption((opt) => opt.setName('id').setDescription('Giveaway ID (default: newest ended)').setRequired(true))
      .addIntegerOption((opt) =>
        opt.setName('winners').setDescription('How many extra winners').setMinValue(1).setMaxValue(20)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List the active giveaways'))
  .addSubcommand((sub) =>
    sub
      .setName('entries')
      .setDescription('Show how many entries a giveaway has')
      .addStringOption((opt) => opt.setName('id').setDescription('Giveaway ID').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Delete a giveaway and its message')
      .addStringOption((opt) => opt.setName('id').setDescription('Giveaway ID').setRequired(true))
  );

async function create(interaction) {
  const config = getGiveawayConfig();
  const prize = interaction.options.getString('prize', true).trim();
  const minutes = interaction.options.getInteger('minutes', true);
  const winners = interaction.options.getInteger('winners') || config.defaultWinners || 1;
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const description = interaction.options.getString('description') || null;
  const requiredRole = interaction.options.getRole('required_role');
  const minAccountAgeDays = interaction.options.getInteger('min_account_age_days') || 0;

  if (!channel?.isTextBased()) {
    return interaction.reply({ content: 'Pick a text channel for the giveaway.', ephemeral: true });
  }
  const me = interaction.guild.members.me;
  if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ content: `I cannot post in ${channel}.`, ephemeral: true });
  }

  const endsAt = new Date(Date.now() + minutes * 60000).toISOString();
  const giveaway = await giveawayStore.createGiveaway({
    guildId: interaction.guild.id,
    channelId: channel.id,
    prize,
    description,
    winners,
    hostId: interaction.user.id,
    requiredRoleId: requiredRole?.id || null,
    minAccountAgeDays,
    endsAt,
    color: config.defaultColor,
  });

  const message = await channel.send({
    embeds: [embed(giveawayEmbedData(giveaway, { entriesCount: 0 }))],
    components: [entryRow(giveaway, 0)],
  });
  await giveawayStore.updateGiveaway(giveaway.id, { messageId: message.id });

  return interaction.reply({
    content: `🎉 Giveaway for **${prize}** started in ${channel} and runs for ${formatDuration(minutes * 60000)}.\n${message.url}`,
    ephemeral: true,
  });
}

async function execute(interaction) {
  const config = getGiveawayConfig();
  if (!canManage(interaction.member)) {
    return interaction.reply({
      content: '❌ Only staff can manage giveaways.',
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'create') return create(interaction);

  if (sub === 'list') {
    const active = await giveawayStore.listGiveaways({ guildId, activeOnly: true });
    if (!active.length) {
      return interaction.reply({ content: 'There are no active giveaways.', ephemeral: true });
    }
    const lines = active.map((g) => {
      const ends = `<t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>`;
      return `**${g.prize}** · ${g.entries.length} entries · ends ${ends} · \`${g.id}\``;
    });
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎉 Active giveaways')
          .setDescription(lines.join('\n').slice(0, 4000))
          .setColor(config.defaultColor),
      ],
      ephemeral: true,
    });
  }

  const id = interaction.options.getString('id');

  if (sub === 'entries') {
    const giveaway = await giveawayStore.getGiveaway(id);
    if (!giveaway || giveaway.guildId !== guildId) {
      return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
    }
    return interaction.reply({
      content: `**${giveaway.prize}** has **${giveaway.entries.length}** entries and ${giveaway.winners} winner(s).`,
      ephemeral: true,
    });
  }

  if (sub === 'delete') {
    const giveaway = await giveawayStore.getGiveaway(id);
    if (!giveaway || giveaway.guildId !== guildId) {
      return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
    }
    await giveawayStore.removeGiveaway(id);
    try {
      const channel = await interaction.client.channels.fetch(giveaway.channelId);
      const message = await channel.messages.fetch(giveaway.messageId);
      await message.delete();
    } catch {
      /* Already gone. */
    }
    return interaction.reply({ content: `🗑️ Deleted the giveaway for **${giveaway.prize}**.`, ephemeral: true });
  }

  if (sub === 'end') {
    const active = await giveawayStore.listGiveaways({ guildId, activeOnly: true });
    const giveaway = id
      ? active.find((g) => g.id === id) || (await giveawayStore.getGiveaway(id))
      : active.sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt))[0];
    if (!giveaway || giveaway.guildId !== guildId) {
      return interaction.reply({ content: 'No active giveaway found.', ephemeral: true });
    }
    if (!isManager(interaction.member, config, giveaway)) {
      return interaction.reply({ content: 'Only the host or staff can end this giveaway.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const { winners, alreadyEnded } = await endGiveaway(interaction.client, giveaway, {
      endedBy: interaction.user.id,
    });
    return interaction.editReply(
      alreadyEnded
        ? 'That giveaway had already ended.'
        : winners.length
          ? `🏆 Winners: ${winners.map((w) => `<@${w}>`).join(', ')}`
          : 'The giveaway ended without entries.'
    );
  }

  if (sub === 'reroll') {
    const giveaway = await giveawayStore.getGiveaway(id);
    if (!giveaway || giveaway.guildId !== guildId) {
      return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
    }
    if (!giveaway.ended) {
      return interaction.reply({ content: 'End the giveaway first, then reroll.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const { winners } = await rerollGiveaway(interaction.client, giveaway, {
      count: interaction.options.getInteger('winners') || 1,
      by: interaction.user.id,
    });
    return interaction.editReply(
      winners.length ? `🔁 New winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}` : 'No eligible entries to reroll.'
    );
  }

  return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

module.exports = { data, execute };
