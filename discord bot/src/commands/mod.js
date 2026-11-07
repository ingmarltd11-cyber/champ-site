const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  parseDuration,
  formatDuration,
  requireStaff,
  botCan,
  logAction,
  dmTarget,
  canActOn,
} = require('../utils/moderation');
const { truncate } = require('../utils/format');

const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Staff moderation: timeout, kick, ban, purge and slowmode')
  .addSubcommand((sub) =>
    sub
      .setName('timeout')
      .setDescription('Time a member out (max 28 days)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) =>
        o.setName('duration').setDescription('e.g. 10m, 2h, 1d (bare number = minutes)').setRequired(true)
      )
      .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub
      .setName('kick')
      .setDescription('Kick a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub
      .setName('ban')
      .setDescription('Ban a member or user id')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500))
      .addIntegerOption((o) =>
        o
          .setName('delete_days')
          .setDescription('Delete this many days of their messages (0-7)')
          .setMinValue(0)
          .setMaxValue(7)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('purge')
      .setDescription('Delete the last N messages in this channel')
      .addIntegerOption((o) =>
        o.setName('count').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('slowmode')
      .setDescription('Set slowmode for this channel (0 turns it off)')
      .addIntegerOption((o) =>
        o.setName('seconds').setDescription('0-21600').setRequired(true).setMinValue(0).setMaxValue(21600)
      )
  );

async function timeout(interaction, client) {
  const member = interaction.options.getMember('user');
  const parsed = parseDuration(interaction.options.getString('duration'));
  if (!parsed) {
    return interaction.editReply('❌ Use a duration between 1s and 28d, like `10m`, `2h` or `1d`.');
  }
  const problem = canActOn(interaction, member);
  if (problem) return interaction.editReply(`❌ ${problem}`);
  if (!botCan(interaction.guild, PermissionFlagsBits.ModerateMembers)) {
    return interaction.editReply('❌ I need the **Moderate Members** permission.');
  }

  const reason = interaction.options.getString('reason') || 'No reason given';
  await dmTarget(
    member.user,
    new EmbedBuilder()
      .setTitle(`You were timed out in ${interaction.guild.name}`)
      .setColor('#FB7185')
      .setDescription(`Duration: **${formatDuration(parsed)}**\nReason: ${truncate(reason, 1000)}`)
      .setTimestamp()
  );
  await member.timeout(parsed, `${reason} · by ${interaction.user.tag}`);

  const embed = new EmbedBuilder()
    .setTitle('🔇 Member timed out')
    .setColor('#FB7185')
    .setDescription(`${member} is timed out for **${formatDuration(parsed)}**.`)
    .addFields({ name: 'Reason', value: truncate(reason, 1000) })
    .setTimestamp();
  await logAction(client, {
    title: '🔇 Timeout',
    color: '#FB7185',
    moderator: interaction.user,
    target: member.user,
    reason,
    fields: [{ name: 'Duration', value: formatDuration(parsed), inline: true }],
  });
  return interaction.editReply({ embeds: [embed] });
}

async function kick(interaction, client) {
  const member = interaction.options.getMember('user');
  const problem = canActOn(interaction, member);
  if (problem) return interaction.editReply(`❌ ${problem}`);
  if (!botCan(interaction.guild, PermissionFlagsBits.KickMembers)) {
    return interaction.editReply('❌ I need the **Kick Members** permission.');
  }
  if (!member.kickable) return interaction.editReply('❌ I cannot kick that member; their role is above mine.');

  const reason = interaction.options.getString('reason') || 'No reason given';
  await dmTarget(
    member.user,
    new EmbedBuilder()
      .setTitle(`You were kicked from ${interaction.guild.name}`)
      .setColor('#FB7185')
      .setDescription(`Reason: ${truncate(reason, 1000)}`)
      .setTimestamp()
  );
  await member.kick(`${reason} · by ${interaction.user.tag}`);

  await logAction(client, {
    title: '👢 Kick',
    color: '#FB7185',
    moderator: interaction.user,
    target: member.user,
    reason,
  });
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('👢 Member kicked')
        .setColor('#FB7185')
        .setDescription(`${member.user.tag} was kicked.`)
        .addFields({ name: 'Reason', value: truncate(reason, 1000) })
        .setTimestamp(),
    ],
  });
}

async function ban(interaction, client) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  if (!user) return interaction.editReply('❌ Could not resolve that user.');
  // A user who already left can still be banned by id; only check hierarchy when they are here.
  const problem = member ? canActOn(interaction, member) : null;
  if (problem) return interaction.editReply(`❌ ${problem}`);
  if (!botCan(interaction.guild, PermissionFlagsBits.BanMembers)) {
    return interaction.editReply('❌ I need the **Ban Members** permission.');
  }
  if (member && !member.bannable) return interaction.editReply('❌ I cannot ban that member; their role is above mine.');

  const reason = interaction.options.getString('reason') || 'No reason given';
  const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
  await dmTarget(
    user,
    new EmbedBuilder()
      .setTitle(`You were banned from ${interaction.guild.name}`)
      .setColor('#FB7185')
      .setDescription(`Reason: ${truncate(reason, 1000)}`)
      .setTimestamp()
  );

  await interaction.guild.bans.create(user, {
    deleteMessageSeconds: deleteDays * 86400,
    reason: `${reason} · by ${interaction.user.tag}`,
  });

  await logAction(client, {
    title: '🔨 Ban',
    color: '#FB7185',
    moderator: interaction.user,
    target: user,
    reason,
    fields: [{ name: 'Messages deleted', value: `${deleteDays}d`, inline: true }],
  });
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('🔨 User banned')
        .setColor('#FB7185')
        .setDescription(`${user.tag} was banned.`)
        .addFields(
          { name: 'Reason', value: truncate(reason, 1000) },
          { name: 'Messages deleted', value: `${deleteDays}d`, inline: true }
        )
        .setTimestamp(),
    ],
  });
}

async function purge(interaction, client) {
  const count = interaction.options.getInteger('count');
  if (!botCan(interaction.guild, PermissionFlagsBits.ManageMessages)) {
    return interaction.editReply('❌ I need the **Manage Messages** permission.');
  }
  const deleted = await interaction.channel.bulkDelete(count, true);
  await logAction(client, {
    title: '🧹 Purge',
    moderator: interaction.user,
    reason: `${deleted.size} message(s) deleted in #${interaction.channel.name}`,
    fields: [{ name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }],
  });
  return interaction.editReply(
    `🧹 Deleted **${deleted.size}** message(s). Messages older than 14 days are skipped by Discord.`
  );
}

async function slowmode(interaction, client) {
  const seconds = interaction.options.getInteger('seconds');
  if (!botCan(interaction.guild, PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply('❌ I need the **Manage Channels** permission.');
  }
  await interaction.channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
  await logAction(client, {
    title: '🐌 Slowmode',
    moderator: interaction.user,
    reason: `${seconds}s in #${interaction.channel.name}`,
    fields: [{ name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }],
  });
  return interaction.editReply(
    seconds === 0 ? '🐌 Slowmode is off.' : `🐌 Slowmode set to **${seconds}s**.`
  );
}

async function execute(interaction, client) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  switch (interaction.options.getSubcommand()) {
    case 'timeout':
      return timeout(interaction, client);
    case 'kick':
      return kick(interaction, client);
    case 'ban':
      return ban(interaction, client);
    case 'purge':
      return purge(interaction, client);
    case 'slowmode':
      return slowmode(interaction, client);
    default:
      return interaction.editReply('Unknown moderation action.');
  }
}

module.exports = { data, execute };
