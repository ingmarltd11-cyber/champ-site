const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const giveawayStore = require('../utils/giveawayStore');
const { getGiveawayConfig, getTicketConfig } = require('../config/loadConfig');
const { giveawayEmbedData } = require('../utils/giveaway');
const { endGiveaway, rerollGiveaway, entryRow, embed } = require('../handlers/giveawayInteractions');
const {
  getWelcomeConfig,
  updateWelcomeConfig,
  resetWelcomeConfig,
} = require('../utils/welcomeSettings');
const { buildWelcomeMessage, buildGoodbyeMessage } = require('../utils/welcome');
const { toEmbed, linkRow } = require('../handlers/welcomeEvents');
const { getRulesConfig, updateRulesConfig, resetRulesConfig } = require('../utils/ruleSettings');
const { buildRulesPayload } = require('../utils/rules');
const { siteUrl, truncate, isHttpUrl } = require('../utils/format');
const {
  parseDuration,
  formatDuration,
  botCan,
  logAction,
  dmTarget,
  canActOn,
} = require('../utils/moderation');
const { buildId, parseId } = require('./ids');
const flows = require('./flows');
const { view, requireStaff, clip } = require('./guiHelpers');

// ---------------------------------------------------------------------------
// Giveaways
// ---------------------------------------------------------------------------

async function giveawaysView(interaction) {
  const active = await giveawayStore
    .listGiveaways({ guildId: interaction.guildId, activeOnly: true })
    .catch(() => []);
  const embed = new EmbedBuilder()
    .setTitle('🎉 Giveaways')
    .setColor(getGiveawayConfig().defaultColor || '#FFC93C')
    .setDescription(
      'Start a giveaway with the button below. Members enter on the giveaway message; you can end, reroll or delete one from **Manage**.'
    )
    .addFields(
      { name: 'Active', value: String(active.length), inline: true },
      {
        name: 'Ending next',
        value: active.length
          ? `<t:${Math.floor(new Date(active.sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt))[0].endsAt).getTime() / 1000)}:R>`
          : '—',
        inline: true,
      }
    );

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'create'))
          .setLabel('Create giveaway')
          .setEmoji('🎉')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'list'))
          .setLabel('Manage giveaways')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'home'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function giveawayModal() {
  const modal = new ModalBuilder().setCustomId(buildId('ctl', 'giveaway', 'modal')).setTitle('Create a giveaway');
  const prize = new TextInputBuilder()
    .setCustomId('prize')
    .setLabel('Prize')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);
  const minutes = new TextInputBuilder()
    .setCustomId('minutes')
    .setLabel('Duration in minutes (1–20160)')
    .setValue('60')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(5);
  const winners = new TextInputBuilder()
    .setCustomId('winners')
    .setLabel('Number of winners (1–20)')
    .setValue('1')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2);
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Extra text above the entry button')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  const minAge = new TextInputBuilder()
    .setCustomId('min_age')
    .setLabel('Minimum Discord account age (days, 0–365)')
    .setValue('0')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3);
  modal.addComponents(
    new ActionRowBuilder().addComponents(prize),
    new ActionRowBuilder().addComponents(minutes),
    new ActionRowBuilder().addComponents(winners),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(minAge)
  );
  return modal;
}

async function giveawayChannelStep(interaction) {
  const draft = flows.get(interaction.user.id, 'giveaway');
  if (!draft) return interaction.reply({ content: 'Start the giveaway again from the panel.', ephemeral: true });
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉 Where should it go?')
        .setColor('#FFC93C')
        .setDescription(`**${draft.prize}** · ${draft.winners} winner(s) · ${draft.minutes} minutes\n\nChoose the channel for the giveaway message.`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'channel'))
          .setPlaceholder('Pick a channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
    ],
  });
}

async function giveawayRoleStep(interaction) {
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉 Entry requirement')
        .setColor('#FFC93C')
        .setDescription('Pick a role members need to enter, or skip to let everyone enter.'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'role'))
          .setPlaceholder('Required role (optional)')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'skip-role'))
          .setLabel('No role requirement')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function createGiveaway(interaction, requiredRoleId = null) {
  const draft = flows.get(interaction.user.id, 'giveaway');
  if (!draft) return view(interaction, { content: 'That draft expired. Start again from the panel.' });
  const channel =
    interaction.guild.channels.cache.get(draft.channelId) ||
    (await interaction.guild.channels.fetch(draft.channelId).catch(() => null));
  if (!channel?.isTextBased()) {
    flows.clear(interaction.user.id, 'giveaway');
    return view(interaction, { content: '❌ That channel is gone. Start again.' });
  }
  const config = getGiveawayConfig();
  const giveaway = await giveawayStore.createGiveaway({
    guildId: interaction.guildId,
    channelId: channel.id,
    prize: draft.prize,
    description: draft.description || null,
    winners: draft.winners,
    hostId: interaction.user.id,
    requiredRoleId,
    minAccountAgeDays: draft.minAge,
    endsAt: new Date(Date.now() + draft.minutes * 60000).toISOString(),
    color: config.defaultColor,
  });
  const message = await channel.send({
    embeds: [embed(giveawayEmbedData(giveaway, { entriesCount: 0 }))],
    components: [entryRow(giveaway, 0)],
  });
  await giveawayStore.updateGiveaway(giveaway.id, { messageId: message.id });
  flows.clear(interaction.user.id, 'giveaway');
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉 Giveaway started')
        .setColor('#22C55E')
        .setDescription(`**${giveaway.prize}** is live in ${channel} for ${draft.minutes} minutes.\n${message.url}`),
    ],
  });
}

async function giveawayList(interaction) {
  const active = await giveawayStore.listGiveaways({ guildId: interaction.guildId, activeOnly: true });
  const ended = (await giveawayStore.listGiveaways({ guildId: interaction.guildId }))
    .filter((giveaway) => giveaway.ended)
    .slice(-10)
    .reverse();
  const all = [...active, ...ended];

  if (!all.length) {
    return view(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('🎉 No giveaways yet')
          .setColor('#FFC93C')
          .setDescription('Create one with the button below.'),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildId('ctl', 'giveaway', 'create'))
            .setLabel('Create giveaway')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(buildId('ctl', 'giveaway', 'create-view'))
            .setLabel('Back')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId('ctl', 'giveaway', 'pick'))
    .setPlaceholder('Open a giveaway...')
    .addOptions(
      all.slice(0, 25).map((giveaway) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(clip(`${giveaway.ended ? '✅' : '🟢'} ${giveaway.prize}`, 100))
          .setValue(giveaway.id)
          .setDescription(
            `${giveaway.entries.length} entries · ${giveaway.ended ? 'ended' : 'active'}`.slice(0, 100)
          )
      )
    );

  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉 Manage giveaways')
        .setColor('#FFC93C')
        .setDescription('Pick one to end, reroll or delete it.'),
    ],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'create'))
          .setLabel('Create giveaway')
          .setEmoji('🎉')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'giveaway', 'create-view'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function giveawayDetail(interaction, id) {
  const giveaway = await giveawayStore.getGiveaway(id);
  if (!giveaway || giveaway.guildId !== interaction.guildId) {
    return view(interaction, { content: 'That giveaway no longer exists.' });
  }
  const data = giveawayEmbedData(giveaway, {
    entriesCount: giveaway.entries.length,
    ended: giveaway.ended,
    winnerIds: giveaway.winnerIds,
  });
  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setColor(data.color || '#FFC93C')
    .setDescription(data.description || null);
  if (data.fields?.length) embed.addFields(data.fields);
  if (data.footer) embed.setFooter({ text: data.footer });

  const row = new ActionRowBuilder();
  if (!giveaway.ended) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'giveaway', 'end', giveaway.id))
        .setLabel('End now')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'giveaway', 'reroll', giveaway.id))
        .setLabel('Reroll')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('ctl', 'giveaway', 'delete', giveaway.id))
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildId('ctl', 'giveaway', 'list'))
      .setLabel('Back')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  );

  return view(interaction, { embeds: [embed], components: [row] });
}

async function handleGiveaway(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];

  if (action === 'create-view' || action === 'list') return giveawayList(interaction);
  if (action === 'create' && interaction.isButton()) {
    if (!requireStaff(interaction)) return;
    return interaction.showModal(giveawayModal());
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    if (!requireStaff(interaction)) return;
    const prize = interaction.fields.getTextInputValue('prize').trim();
    const minutes = Number(interaction.fields.getTextInputValue('minutes'));
    const winners = Number(interaction.fields.getTextInputValue('winners') || 1);
    const minAge = Number(interaction.fields.getTextInputValue('min_age') || 0);
    const description = interaction.fields.getTextInputValue('description').trim();
    if (!prize) return interaction.reply({ content: '❌ A prize is required.', ephemeral: true });
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20160) {
      return interaction.reply({ content: '❌ Duration must be 1–20160 minutes.', ephemeral: true });
    }
    if (!Number.isInteger(winners) || winners < 1 || winners > 20) {
      return interaction.reply({ content: '❌ Winners must be 1–20.', ephemeral: true });
    }
    if (!Number.isInteger(minAge) || minAge < 0 || minAge > 365) {
      return interaction.reply({ content: '❌ Minimum account age must be 0–365 days.', ephemeral: true });
    }
    flows.set(interaction.user.id, 'giveaway', {
      prize,
      minutes,
      winners,
      description,
      minAge,
    });
    return giveawayChannelStep(interaction);
  }
  if (action === 'channel' && interaction.isChannelSelectMenu()) {
    if (!requireStaff(interaction)) return;
    flows.update(interaction.user.id, 'giveaway', { channelId: interaction.values[0] });
    return giveawayRoleStep(interaction);
  }
  if (action === 'role' && interaction.isRoleSelectMenu()) {
    if (!requireStaff(interaction)) return;
    const role = interaction.guild.roles.cache.get(interaction.values[0]);
    if (!role || role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Pick a normal role (not @everyone).', ephemeral: true });
    }
    return createGiveaway(interaction, role.id);
  }
  if (action === 'skip-role') {
    if (!requireStaff(interaction)) return;
    return createGiveaway(interaction, null);
  }
  if (action === 'pick' && interaction.isStringSelectMenu()) {
    if (!requireStaff(interaction)) return;
    return giveawayDetail(interaction, interaction.values[0]);
  }
  if (action === 'end' || action === 'reroll' || action === 'delete') {
    if (!requireStaff(interaction)) return;
    const giveaway = await giveawayStore.getGiveaway(arg);
    if (!giveaway || giveaway.guildId !== interaction.guildId) {
      return view(interaction, { content: 'That giveaway no longer exists.' });
    }
    if (action === 'delete') {
      await giveawayStore.removeGiveaway(giveaway.id);
      try {
        const channel = await interaction.client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(giveaway.messageId);
        await message.delete();
      } catch {
        /* already gone */
      }
      return view(interaction, { content: `🗑️ Deleted the giveaway for **${giveaway.prize}**.` });
    }
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    if (action === 'end') {
      const result = await endGiveaway(interaction.client, giveaway, { endedBy: interaction.user.id });
      return interaction.editReply({
        content: result.winners.length
          ? `🏆 Winners: ${result.winners.map((id) => `<@${id}>`).join(', ')}`
          : 'The giveaway ended without entries.',
      });
    }
    const result = await rerollGiveaway(interaction.client, giveaway, { by: interaction.user.id });
    return interaction.editReply({
      content: result.winners.length
        ? `🔁 New winner(s): ${result.winners.map((id) => `<@${id}>`).join(', ')}`
        : 'No eligible entries to reroll.',
    });
  }
  return false;
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

async function welcomePreview(interaction) {
  const config = getWelcomeConfig();
  const welcome = buildWelcomeMessage(interaction.member, config, { memberCount: interaction.guild.memberCount });
  const row = linkRow(welcome.links);
  return interaction.reply({
    content: '👀 Preview — only you can see this.',
    embeds: welcome.embeds.map(toEmbed),
    components: row ? [row] : [],
    ephemeral: true,
  });
}

async function welcomeTest(interaction, channel = null) {
  const config = getWelcomeConfig();
  const welcome = buildWelcomeMessage(interaction.member, config, { memberCount: interaction.guild.memberCount });
  const row = linkRow(welcome.links);
  const target = channel || interaction.channel;
  const message = await target.send({
    content: welcome.content || undefined,
    embeds: welcome.embeds.map(toEmbed),
    components: row ? [row] : [],
    allowedMentions: { users: [interaction.user.id] },
  });
  return view(interaction, { content: `✅ Test welcome sent: ${message.url}` });
}

async function welcomeView(interaction) {
  const config = getWelcomeConfig();
  const embed = new EmbedBuilder()
    .setTitle('👋 Welcome & goodbye')
    .setColor(config.embed?.color || '#FFC93C')
    .addFields(
      { name: 'Enabled', value: config.enabled ? 'yes' : 'no', inline: true },
      {
        name: 'Welcome channel',
        value: config.channelId ? `<#${config.channelId}>` : 'automatic',
        inline: true,
      },
      {
        name: 'Goodbye channel',
        value: config.goodbyeChannelId ? `<#${config.goodbyeChannelId}>` : 'welcome channel',
        inline: true,
      },
      { name: 'Welcome DM', value: config.dm?.enabled ? 'on' : 'off', inline: true },
      {
        name: 'Auto roles',
        value: config.autoRoles?.length ? config.autoRoles.map((id) => `<@&${id}>`).join(', ') : 'none',
      }
    )
    .setFooter({ text: 'Placeholders: {user} {mention} {username} {server} {memberCount} {site} {rules}' });

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'preview'))
          .setLabel('Preview')
          .setEmoji('👀')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'test'))
          .setLabel('Send test')
          .setEmoji('📨')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'toggle'))
          .setLabel(config.enabled ? 'Disable' : 'Enable')
          .setEmoji(config.enabled ? '⏸️' : '▶️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'settings'))
          .setLabel('Settings')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'home'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'test-channel'))
          .setPlaceholder('Send a test to a specific channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
    ],
  });
}

async function welcomeSettingsView(interaction) {
  const config = getWelcomeConfig();
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('⚙️ Welcome settings')
        .setColor(config.embed?.color || '#FFC93C')
        .setDescription(
          'Pick channels and roles below. Changes are stored on the volume and survive restarts.'
        )
        .addFields(
          { name: 'Auto roles', value: String(config.autoRoles?.length || 0), inline: true },
          { name: 'DM', value: config.dm?.enabled ? 'on' : 'off', inline: true }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'set', 'welcome'))
          .setPlaceholder('Welcome channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'set', 'goodbye'))
          .setPlaceholder('Goodbye channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'role-add'))
          .setPlaceholder('Add an auto role...')
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'role-remove'))
          .setPlaceholder('Remove an auto role...')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'dm'))
          .setLabel(`Welcome DM: ${config.dm?.enabled ? 'on' : 'off'}`)
          .setEmoji('✉️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'edit'))
          .setLabel('Edit texts')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'reset'))
          .setLabel('Reset')
          .setEmoji('♻️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'welcome', 'main'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function welcomeEditModal() {
  const config = getWelcomeConfig();
  const modal = new ModalBuilder().setCustomId(buildId('ctl', 'welcome', 'edit-modal')).setTitle('Edit welcome texts');
  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Welcome embed title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(250)
    .setValue(String(config.embed?.title || 'Welcome to Champ, {username}!').slice(0, 250));
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Welcome description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(String(config.embed?.description || '').slice(0, 2000));
  const goodbye = new TextInputBuilder()
    .setCustomId('goodbye')
    .setLabel('Goodbye description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(String(config.goodbye?.description || '').slice(0, 2000));
  const goodbyeTitle = new TextInputBuilder()
    .setCustomId('goodbye_title')
    .setLabel('Goodbye embed title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(250)
    .setValue(String(config.goodbye?.title || 'Goodbye, {username}').slice(0, 250));
  const dm = new TextInputBuilder()
    .setCustomId('dm')
    .setLabel('Welcome DM text')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setValue(String(config.dm?.message || '').slice(0, 2000));
  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(goodbyeTitle),
    new ActionRowBuilder().addComponents(goodbye),
    new ActionRowBuilder().addComponents(dm)
  );
  return modal;
}

async function handleWelcome(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];
  const config = getWelcomeConfig();

  if (action === 'preview') return welcomePreview(interaction);
  if (action === 'test') {
    if (!requireStaff(interaction)) return;
    return welcomeTest(interaction);
  }
  if (action === 'test-channel' && interaction.isChannelSelectMenu()) {
    if (!requireStaff(interaction)) return;
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel?.isTextBased()) return interaction.reply({ content: '❌ Pick a text channel.', ephemeral: true });
    return welcomeTest(interaction, channel);
  }
  if (action === 'toggle') {
    if (!requireStaff(interaction)) return;
    await updateWelcomeConfig({ enabled: !config.enabled });
    return welcomeView(interaction);
  }
  if (action === 'settings') {
    if (!requireStaff(interaction)) return;
    return welcomeSettingsView(interaction);
  }
  if (action === 'main') return welcomeView(interaction);
  if (action === 'set' && interaction.isChannelSelectMenu()) {
    if (!requireStaff(interaction)) return;
    await updateWelcomeConfig(arg === 'goodbye' ? { goodbyeChannelId: interaction.values[0] } : { channelId: interaction.values[0] });
    return welcomeSettingsView(interaction);
  }
  if ((action === 'role-add' || action === 'role-remove') && interaction.isRoleSelectMenu()) {
    if (!requireStaff(interaction)) return;
    const role = interaction.guild.roles.cache.get(interaction.values[0]);
    if (!role || role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Pick a normal role.', ephemeral: true });
    }
    const roles = new Set(config.autoRoles || []);
    if (action === 'role-add') roles.add(role.id);
    else roles.delete(role.id);
    await updateWelcomeConfig({ autoRoles: [...roles] });
    return welcomeSettingsView(interaction);
  }
  if (action === 'dm') {
    if (!requireStaff(interaction)) return;
    await updateWelcomeConfig({ dm: { enabled: !config.dm?.enabled } });
    return welcomeSettingsView(interaction);
  }
  if (action === 'edit') {
    if (!requireStaff(interaction)) return;
    return interaction.showModal(welcomeEditModal());
  }
  if (action === 'edit-modal' && interaction.isModalSubmit()) {
    if (!requireStaff(interaction)) return;
    await updateWelcomeConfig({
      embed: {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
      },
      goodbye: {
        title: interaction.fields.getTextInputValue('goodbye_title'),
        description: interaction.fields.getTextInputValue('goodbye'),
      },
      dm: { message: interaction.fields.getTextInputValue('dm') || config.dm?.message || '' },
    });
    return welcomeSettingsView(interaction);
  }
  if (action === 'reset') {
    if (!requireStaff(interaction)) return;
    await resetWelcomeConfig();
    return welcomeSettingsView(interaction);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

async function rulesView(interaction) {
  const rules = getRulesConfig();
  const embed = new EmbedBuilder()
    .setTitle('📜 Server rules')
    .setColor(rules.color || '#2EC4B6')
    .setDescription(rules.intro || 'The rules panel is ready to post.')
    .addFields(
      { name: 'Sections', value: String(rules.sections?.length || 0), inline: true },
      { name: 'Terms button', value: rules.showTermsButton === false ? 'off' : 'on', inline: true },
      { name: 'Footer', value: truncate(rules.footer || '—', 300) }
    );

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'rules', 'post-channel'))
          .setPlaceholder('Post the rules in...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'rules', 'intro'))
          .setLabel('Edit intro')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'rules', 'footer'))
          .setLabel('Edit footer')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'rules', 'terms'))
          .setLabel(rules.showTermsButton === false ? 'Enable terms button' : 'Disable terms button')
          .setEmoji('📄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'rules', 'preview'))
          .setLabel('Preview')
          .setEmoji('👀')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'rules', 'reset'))
          .setLabel('Reset')
          .setEmoji('♻️')
          .setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'home'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function rulesTextModal(kind, value) {
  const modal = new ModalBuilder()
    .setCustomId(buildId('ctl', 'rules', `${kind}-modal`))
    .setTitle(kind === 'intro' ? 'Edit the rules intro' : 'Edit the rules footer');
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel(kind === 'intro' ? 'Intro text' : 'Footer text')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(kind === 'intro')
    .setMaxLength(kind === 'intro' ? 2000 : 500)
    .setValue(String(value || '').slice(0, kind === 'intro' ? 2000 : 500));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handleRules(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  if (!requireStaff(interaction)) return;

  if (action === 'post-channel' && interaction.isChannelSelectMenu()) {
    const rules = getRulesConfig();
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel?.isTextBased()) return view(interaction, { content: '❌ Pick a text channel.' });
    const message = await channel.send(buildRulesPayload(rules));
    return view(interaction, { content: `✅ Rules posted in ${channel}. [Jump to them](${message.url})` });
  }
  if (action === 'intro' || action === 'footer') {
    const rules = getRulesConfig();
    return interaction.showModal(rulesTextModal(action, action === 'intro' ? rules.intro : rules.footer));
  }
  if ((action === 'intro-modal' || action === 'footer-modal') && interaction.isModalSubmit()) {
    const text = interaction.fields.getTextInputValue('text');
    await updateRulesConfig(action === 'intro-modal' ? { intro: text } : { footer: text });
    return rulesView(interaction);
  }
  if (action === 'terms') {
    const rules = getRulesConfig();
    await updateRulesConfig({ showTermsButton: rules.showTermsButton === false });
    return rulesView(interaction);
  }
  if (action === 'preview') {
    return interaction.reply({ ...buildRulesPayload(getRulesConfig()), ephemeral: true });
  }
  if (action === 'reset') {
    await resetRulesConfig();
    return rulesView(interaction);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

async function announceView(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📣 Announcements')
    .setColor('#2EC4B6')
    .setDescription(
      'Write the announcement once, choose a channel, then decide whether to ping nobody, @here or @everyone.'
    );
  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'new'))
          .setLabel('New announcement')
          .setEmoji('📣')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'home'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function announceModal() {
  const modal = new ModalBuilder().setCustomId(buildId('ctl', 'announce', 'modal')).setTitle('New announcement');
  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Headline')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256);
  const message = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('Body (markdown works)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);
  const image = new TextInputBuilder()
    .setCustomId('image')
    .setLabel('Image URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);
  const buttonLabel = new TextInputBuilder()
    .setCustomId('button_label')
    .setLabel('Button text (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80);
  const buttonUrl = new TextInputBuilder()
    .setCustomId('button_url')
    .setLabel('Button URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);
  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(message),
    new ActionRowBuilder().addComponents(image),
    new ActionRowBuilder().addComponents(buttonLabel),
    new ActionRowBuilder().addComponents(buttonUrl)
  );
  return modal;
}

async function announceChannelStep(interaction) {
  const draft = flows.get(interaction.user.id, 'announce');
  if (!draft) return view(interaction, { content: 'Start the announcement again.' });
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('📣 Where should it go?')
        .setColor('#2EC4B6')
        .setDescription(`**${clip(draft.title, 100)}**\n\nChoose the channel, then the ping.`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'announce', 'channel'))
          .setPlaceholder('Pick a channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  });
}

async function announcePingStep(interaction) {
  const draft = flows.get(interaction.user.id, 'announce');
  if (!draft?.channelId) return announceChannelStep(interaction);
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('📣 Who should be pinged?')
        .setColor('#2EC4B6')
        .setDescription(`Posting in <#${draft.channelId}>.`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'ping', 'none'))
          .setLabel('Nobody')
          .setEmoji('🔕')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'ping', 'here'))
          .setLabel('@here')
          .setEmoji('📢')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'ping', 'everyone'))
          .setLabel('@everyone')
          .setEmoji('📣')
          .setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'announce', 'cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function postAnnouncement(interaction, ping) {
  const draft = flows.get(interaction.user.id, 'announce');
  if (!draft?.channelId) return announceChannelStep(interaction);
  const channel = interaction.guild.channels.cache.get(draft.channelId);
  if (!channel?.isTextBased()) {
    flows.clear(interaction.user.id, 'announce');
    return view(interaction, { content: '❌ That channel is gone.' });
  }
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'CHAMP CLIENT', iconURL: `${siteUrl()}/assets/logo-teal.png` })
    .setTitle(truncate(draft.title, 256))
    .setDescription(draft.message)
    .setColor('#2EC4B6')
    .setTimestamp()
    .setFooter({ text: `${interaction.guild.name} · announcement` });
  if (draft.image) embed.setImage(draft.image);
  const payload = {
    content: ping === 'none' ? undefined : ping === 'here' ? '@here' : '@everyone',
    embeds: [embed],
    allowedMentions: ping === 'none' ? { parse: [] } : { parse: ['everyone'] },
  };
  if (draft.buttonUrl) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(truncate(draft.buttonLabel || 'Open', 80))
          .setURL(draft.buttonUrl)
          .setStyle(ButtonStyle.Link)
      ),
    ];
  }
  const message = await channel.send(payload);
  flows.clear(interaction.user.id, 'announce');
  return view(interaction, { content: `✅ Announcement posted in ${channel}. [Jump to it](${message.url})` });
}

async function handleAnnounce(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];
  if (!requireStaff(interaction)) return;

  if (action === 'new') return interaction.showModal(announceModal());
  if (action === 'modal' && interaction.isModalSubmit()) {
    const title = interaction.fields.getTextInputValue('title').trim();
    const message = interaction.fields.getTextInputValue('message').trim();
    const image = interaction.fields.getTextInputValue('image').trim();
    const buttonUrl = interaction.fields.getTextInputValue('button_url').trim();
    const buttonLabel = interaction.fields.getTextInputValue('button_label').trim();
    if (!title || !message) {
      return interaction.reply({ content: '❌ A title and message are required.', ephemeral: true });
    }
    if (image && !isHttpUrl(image)) {
      return interaction.reply({ content: '❌ The image must be an http(s) URL.', ephemeral: true });
    }
    if (buttonUrl && !isHttpUrl(buttonUrl)) {
      return interaction.reply({ content: '❌ The button URL must start with http(s)://', ephemeral: true });
    }
    flows.set(interaction.user.id, 'announce', { title, message, image, buttonUrl, buttonLabel });
    return announceChannelStep(interaction);
  }
  if (action === 'channel' && interaction.isChannelSelectMenu()) {
    flows.update(interaction.user.id, 'announce', { channelId: interaction.values[0] });
    return announcePingStep(interaction);
  }
  if (action === 'ping') return postAnnouncement(interaction, arg);
  if (action === 'cancel') {
    flows.clear(interaction.user.id, 'announce');
    return view(interaction, { content: 'Cancelled.' });
  }
  return false;
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

async function moderationView(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Moderation')
    .setColor('#FB7185')
    .setDescription(
      'Pick an action. Every action asks for a member or a value first, then writes to the mod log when `MOD_LOG_CHANNEL_ID` is set.'
    );
  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'mod', 'action'))
          .setPlaceholder('Choose a moderation action...')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Timeout').setValue('timeout').setEmoji('🔇').setDescription('Temporarily mute a member'),
            new StringSelectMenuOptionBuilder().setLabel('Kick').setValue('kick').setEmoji('👢').setDescription('Remove a member from the server'),
            new StringSelectMenuOptionBuilder().setLabel('Ban').setValue('ban').setEmoji('🔨').setDescription('Ban a member and optionally delete messages'),
            new StringSelectMenuOptionBuilder().setLabel('Purge').setValue('purge').setEmoji('🧹').setDescription('Delete the last N messages here'),
            new StringSelectMenuOptionBuilder().setLabel('Slowmode').setValue('slowmode').setEmoji('🐌').setDescription('Set the channel slowmode')
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'home'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

function modModal(action) {
  const modal = new ModalBuilder().setCustomId(buildId('ctl', 'mod', 'modal', action)).setTitle(`Moderation · ${action}`);
  if (action === 'timeout') {
    const duration = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration (10m, 2h, 1d; max 28d)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10)
      .setValue('10m');
    const reason = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(duration), new ActionRowBuilder().addComponents(reason));
  } else if (action === 'kick') {
    const reason = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(reason));
  } else if (action === 'ban') {
    const reason = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);
    const days = new TextInputBuilder()
      .setCustomId('delete_days')
      .setLabel('Delete message days (0–7)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(1)
      .setValue('0');
    modal.addComponents(new ActionRowBuilder().addComponents(reason), new ActionRowBuilder().addComponents(days));
  } else if (action === 'purge') {
    const count = new TextInputBuilder()
      .setCustomId('count')
      .setLabel('How many messages (1–100)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue('10');
    modal.addComponents(new ActionRowBuilder().addComponents(count));
  } else if (action === 'slowmode') {
    const seconds = new TextInputBuilder()
      .setCustomId('seconds')
      .setLabel('Slowmode seconds (0–21600)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(5)
      .setValue('5');
    modal.addComponents(new ActionRowBuilder().addComponents(seconds));
  }
  return modal;
}

async function performTimeout(interaction, member, durationText, reasonText) {
  const parsed = parseDuration(durationText);
  if (!parsed) return interaction.editReply({ content: '❌ Use 1s–28d, like `10m`, `2h` or `1d`.' });
  const problem = canActOn(interaction, member);
  if (problem) return interaction.editReply({ content: `❌ ${problem}` });
  if (!botCan(interaction.guild, PermissionFlagsBits.ModerateMembers)) {
    return interaction.editReply({ content: '❌ I need **Moderate Members**.' });
  }
  const reason = reasonText || 'No reason given';
  await dmTarget(
    member.user,
    new EmbedBuilder()
      .setTitle(`You were timed out in ${interaction.guild.name}`)
      .setColor('#FB7185')
      .setDescription(`Duration: **${formatDuration(parsed)}**\nReason: ${truncate(reason, 1000)}`)
      .setTimestamp()
  );
  await member.timeout(parsed, `${reason} · by ${interaction.user.tag}`);
  await logAction(interaction.client, {
    title: '🔇 Timeout',
    color: '#FB7185',
    moderator: interaction.user,
    target: member.user,
    reason,
    fields: [{ name: 'Duration', value: formatDuration(parsed), inline: true }],
  });
  return interaction.editReply({ content: `🔇 ${member} is timed out for **${formatDuration(parsed)}**.` });
}

async function performKick(interaction, member, reasonText) {
  const problem = canActOn(interaction, member);
  if (problem) return interaction.editReply({ content: `❌ ${problem}` });
  if (!botCan(interaction.guild, PermissionFlagsBits.KickMembers)) {
    return interaction.editReply({ content: '❌ I need **Kick Members**.' });
  }
  if (!member.kickable) return interaction.editReply({ content: '❌ Their role is above mine.' });
  const reason = reasonText || 'No reason given';
  await dmTarget(
    member.user,
    new EmbedBuilder()
      .setTitle(`You were kicked from ${interaction.guild.name}`)
      .setColor('#FB7185')
      .setDescription(`Reason: ${truncate(reason, 1000)}`)
      .setTimestamp()
  );
  await member.kick(`${reason} · by ${interaction.user.tag}`);
  await logAction(interaction.client, {
    title: '👢 Kick',
    color: '#FB7185',
    moderator: interaction.user,
    target: member.user,
    reason,
  });
  return interaction.editReply({ content: `👢 ${member.user.tag} was kicked.` });
}

async function performBan(interaction, member, reasonText, deleteDays) {
  const problem = member ? canActOn(interaction, member) : null;
  if (problem) return interaction.editReply({ content: `❌ ${problem}` });
  if (!botCan(interaction.guild, PermissionFlagsBits.BanMembers)) {
    return interaction.editReply({ content: '❌ I need **Ban Members**.' });
  }
  if (member && !member.bannable) return interaction.editReply({ content: '❌ Their role is above mine.' });
  const user = member?.user || (await interaction.client.users.fetch(member?.id).catch(() => null));
  if (!user) return interaction.editReply({ content: '❌ Could not resolve that member.' });
  const reason = reasonText || 'No reason given';
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
  await logAction(interaction.client, {
    title: '🔨 Ban',
    color: '#FB7185',
    moderator: interaction.user,
    target: user,
    reason,
    fields: [{ name: 'Messages deleted', value: `${deleteDays}d`, inline: true }],
  });
  return interaction.editReply({ content: `🔨 ${user.tag} was banned.` });
}

async function performPurge(interaction, count) {
  if (!botCan(interaction.guild, PermissionFlagsBits.ManageMessages)) {
    return interaction.editReply({ content: '❌ I need **Manage Messages**.' });
  }
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return interaction.editReply({ content: '❌ Count must be 1–100.' });
  }
  const deleted = await interaction.channel.bulkDelete(count, true);
  await logAction(interaction.client, {
    title: '🧹 Purge',
    moderator: interaction.user,
    reason: `${deleted.size} message(s) deleted in #${interaction.channel.name}`,
    fields: [{ name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }],
  });
  return interaction.editReply({ content: `🧹 Deleted **${deleted.size}** message(s).` });
}

async function performSlowmode(interaction, seconds) {
  if (!botCan(interaction.guild, PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply({ content: '❌ I need **Manage Channels**.' });
  }
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
    return interaction.editReply({ content: '❌ Slowmode must be 0–21600 seconds.' });
  }
  await interaction.channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
  await logAction(interaction.client, {
    title: '🐌 Slowmode',
    moderator: interaction.user,
    reason: `${seconds}s in #${interaction.channel.name}`,
    fields: [{ name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }],
  });
  return interaction.editReply({ content: seconds === 0 ? '🐌 Slowmode is off.' : `🐌 Slowmode set to **${seconds}s**.` });
}

async function handleModeration(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];
  if (!requireStaff(interaction)) return;

  if (action === 'action' && interaction.isStringSelectMenu()) {
    const selected = interaction.values[0];
    if (selected === 'purge' || selected === 'slowmode') {
      return interaction.showModal(modModal(selected));
    }
    return view(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle(`🛡️ ${selected}`)
          .setColor('#FB7185')
          .setDescription('Choose the member this applies to.'),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(buildId('ctl', 'mod', 'user', selected))
            .setPlaceholder('Pick a member...')
            .setMaxValues(1)
        ),
      ],
    });
  }
  if (action === 'user' && interaction.isUserSelectMenu()) {
    flows.set(interaction.user.id, 'mod', { action: arg, targetId: interaction.values[0] });
    return interaction.showModal(modModal(arg));
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    const current = flows.get(interaction.user.id, 'mod') || {};
    const mode = arg;
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    if (mode === 'purge') {
      return performPurge(interaction, Number(interaction.fields.getTextInputValue('count')));
    }
    if (mode === 'slowmode') {
      return performSlowmode(interaction, Number(interaction.fields.getTextInputValue('seconds')));
    }
    const targetId = current.targetId;
    const member = targetId ? await interaction.guild.members.fetch(targetId).catch(() => null) : null;
    if (!member) return interaction.editReply({ content: '❌ That member is no longer in the server.' });
    const reason = interaction.fields.getTextInputValue('reason') || '';
    if (mode === 'timeout') {
      return performTimeout(interaction, member, interaction.fields.getTextInputValue('duration'), reason);
    }
    if (mode === 'kick') return performKick(interaction, member, reason);
    if (mode === 'ban') {
      const days = Number(interaction.fields.getTextInputValue('delete_days') || 0);
      if (!Number.isInteger(days) || days < 0 || days > 7) {
        return interaction.editReply({ content: '❌ Delete days must be 0–7.' });
      }
      return performBan(interaction, member, reason, days);
    }
    return interaction.editReply({ content: 'Unknown moderation action.' });
  }
  if (action === 'cancel') return view(interaction, { content: 'Cancelled.' });
  return false;
}

module.exports = {
  giveawaysView,
  handleGiveaway,
  welcomeView,
  welcomeSettingsView,
  welcomePreview,
  welcomeTest,
  handleWelcome,
  rulesView,
  handleRules,
  announceView,
  handleAnnounce,
  moderationView,
  handleModeration,
  createGiveaway,
  giveawayList,
  giveawayDetail,
  giveawayModal,
  giveawayChannelStep,
  giveawayRoleStep,
  welcomeEditModal,
  rulesTextModal,
  announceModal,
  announceChannelStep,
  modModal,
};
