const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { getWelcomeConfig, updateWelcomeConfig, resetWelcomeConfig } = require('../utils/welcomeSettings');
const { buildWelcomeMessage, buildGoodbyeMessage, PLACEHOLDERS } = require('../utils/welcome');
const { toEmbed, linkRow } = require('../handlers/welcomeEvents');
const { getGiveawayConfig } = require('../config/loadConfig');

function canManage(member) {
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return (getGiveawayConfig().managerRoleIds || []).some((id) => member?.roles?.cache?.has(id));
}

const data = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Set up the welcome and goodbye messages')
  .addSubcommand((sub) => sub.setName('status').setDescription('Show the current welcome settings'))
  .addSubcommand((sub) =>
    sub
      .setName('preview')
      .setDescription('Preview the welcome message only you can see')
  )
  .addSubcommand((sub) =>
    sub
      .setName('test')
      .setDescription('Post a real welcome message for yourself')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Post here instead of the configured welcome channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the welcome and/or goodbye channel')
      .addChannelOption((opt) =>
        opt
          .setName('welcome')
          .setDescription('Channel for new members')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addChannelOption((opt) =>
        opt
          .setName('goodbye')
          .setDescription('Channel for members who leave')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('autorole')
      .setDescription('Roles every new member gets')
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Add, remove or list')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' }
          )
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('The role to add or remove'))
  )
  .addSubcommand((sub) =>
    sub
      .setName('dm')
      .setDescription('Welcome new members in a direct message')
      .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn the welcome DM on or off').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('message').setDescription('Text of the DM (placeholders allowed)').setMaxLength(2000)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('message')
      .setDescription('Change the welcome, goodbye or DM text')
      .addStringOption((opt) =>
        opt
          .setName('kind')
          .setDescription('Which message')
          .setRequired(true)
          .addChoices(
            { name: 'welcome', value: 'welcome' },
            { name: 'goodbye', value: 'goodbye' },
            { name: 'dm', value: 'dm' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('text').setDescription('New message text (placeholders allowed)').setRequired(true).setMaxLength(2000)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('title')
      .setDescription('Change the welcome or goodbye embed title')
      .addStringOption((opt) =>
        opt
          .setName('kind')
          .setDescription('Which embed')
          .setRequired(true)
          .addChoices(
            { name: 'welcome', value: 'welcome' },
            { name: 'goodbye', value: 'goodbye' }
          )
      )
      .addStringOption((opt) => opt.setName('text').setDescription('New title').setRequired(true).setMaxLength(250))
  )
  .addSubcommand((sub) => sub.setName('reset').setDescription('Reset every welcome setting to the file defaults'));

async function execute(interaction) {
  if (!canManage(interaction.member)) {
    return interaction.reply({ content: '❌ Only staff can configure the welcome system.', ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  const config = getWelcomeConfig();

  if (sub === 'status') {
    const embed = new EmbedBuilder()
      .setTitle('👋 Welcome settings')
      .setColor(config.embed?.color || '#FFC93C')
      .addFields(
        { name: 'Enabled', value: config.enabled ? 'yes' : 'no', inline: true },
        {
          name: 'Welcome channel',
          value: config.channelId ? `<#${config.channelId}>` : 'not set',
          inline: true,
        },
        {
          name: 'Goodbye channel',
          value: config.goodbyeChannelId ? `<#${config.goodbyeChannelId}>` : 'same as welcome',
          inline: true,
        },
        { name: 'Welcome DM', value: config.dm?.enabled ? 'on' : 'off', inline: true },
        {
          name: 'Auto roles',
          value: config.autoRoles?.length ? config.autoRoles.map((id) => `<@&${id}>`).join(', ') : 'none',
        },
        {
          name: 'Placeholders',
          value: PLACEHOLDERS.join(' ') + '\nUse these in `/welcome message`.',
        }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'preview') {
    const welcome = buildWelcomeMessage(interaction.member, config, {
      memberCount: interaction.guild.memberCount,
    });
    const row = linkRow(welcome.links);
    return interaction.reply({
      content: 'Preview — this is what a new member sees:',
      embeds: welcome.embeds.map(toEmbed),
      components: row ? [row] : [],
      ephemeral: true,
    });
  }

  if (sub === 'test') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const welcome = buildWelcomeMessage(interaction.member, config, {
      memberCount: interaction.guild.memberCount,
    });
    const row = linkRow(welcome.links);
    const message = await channel.send({
      content: welcome.content || undefined,
      embeds: welcome.embeds.map(toEmbed),
      components: row ? [row] : [],
      allowedMentions: { users: [interaction.user.id] },
    });
    return interaction.reply({ content: `✅ Test welcome sent: ${message.url}`, ephemeral: true });
  }

  if (sub === 'channel') {
    const welcome = interaction.options.getChannel('welcome');
    const goodbye = interaction.options.getChannel('goodbye');
    if (!welcome && !goodbye) {
      return interaction.reply({ content: 'Give a welcome and/or goodbye channel.', ephemeral: true });
    }
    const patch = {};
    if (welcome) patch.channelId = welcome.id;
    if (goodbye) patch.goodbyeChannelId = goodbye.id;
    await updateWelcomeConfig(patch);
    return interaction.reply({
      content: `✅ ${welcome ? `Welcome channel: ${welcome}. ` : ''}${goodbye ? `Goodbye channel: ${goodbye}.` : ''}`,
      ephemeral: true,
    });
  }

  if (sub === 'autorole') {
    const mode = interaction.options.getString('mode', true);
    const role = interaction.options.getRole('role');
    const current = new Set(config.autoRoles || []);
    if (mode === 'list') {
      return interaction.reply({
        content: current.size ? [...current].map((id) => `<@&${id}>`).join(', ') : 'No auto roles set.',
        ephemeral: true,
      });
    }
    if (!role) {
      return interaction.reply({ content: 'Pick a role with `role:`.', ephemeral: true });
    }
    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: 'The @everyone role cannot be an auto role.', ephemeral: true });
    }
    if (mode === 'add') current.add(role.id);
    else current.delete(role.id);
    await updateWelcomeConfig({ autoRoles: [...current] });
    return interaction.reply({
      content: mode === 'add' ? `✅ ${role} will be added to every new member.` : `✅ ${role} is no longer an auto role.`,
      ephemeral: true,
    });
  }

  if (sub === 'dm') {
    const enabled = interaction.options.getBoolean('enabled', true);
    const text = interaction.options.getString('message');
    const patch = { dm: { enabled } };
    if (text) patch.dm.message = text;
    await updateWelcomeConfig(patch);
    return interaction.reply({
      content: `✅ Welcome DM is now **${enabled ? 'on' : 'off'}**.`,
      ephemeral: true,
    });
  }

  if (sub === 'message') {
    const kind = interaction.options.getString('kind', true);
    const text = interaction.options.getString('text', true);
    const patch =
      kind === 'dm'
        ? { dm: { message: text } }
        : kind === 'welcome'
          ? { embed: { description: text } }
          : { goodbye: { description: text } };
    await updateWelcomeConfig(patch);
    return interaction.reply({ content: `✅ The ${kind} message is updated.`, ephemeral: true });
  }

  if (sub === 'title') {
    const kind = interaction.options.getString('kind', true);
    const text = interaction.options.getString('text', true);
    await updateWelcomeConfig(kind === 'welcome' ? { embed: { title: text } } : { goodbye: { title: text } });
    return interaction.reply({ content: `✅ The ${kind} title is updated.`, ephemeral: true });
  }

  if (sub === 'reset') {
    await resetWelcomeConfig();
    return interaction.reply({ content: '✅ Welcome settings reset to the file defaults.', ephemeral: true });
  }

  return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

module.exports = { data, execute };
