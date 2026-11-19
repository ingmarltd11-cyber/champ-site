const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const {
  getTicketConfig,
  getKnowledgeConfig,
  getPaymentConfig,
} = require('../config/loadConfig');
const ticketStore = require('../utils/ticketStore');
const giveawayStore = require('../utils/giveawayStore');
const knowledgeStore = require('../knowledge/knowledgeStore');
const { syncForum } = require('../knowledge/knowledgeSync');
const panelStore = require('./panelStore');
const controlStore = require('./controlStore');
const { PANEL_TYPES, renderPanel } = require('../panels');
const misc = require('../panels/misc');
const { buildId, parseId } = require('./ids');
const { view, requireStaff, staff, clip } = require('./guiHelpers');
const { postPanel, refreshPanel, deletePanelMessage } = require('./panelRuntime');
const actions = require('./controlActions');
const knowledgeInteractions = require('../handlers/knowledgeInteractions');
const paymentInteractions = require('../handlers/paymentInteractions');
const ticketInteractions = require('../handlers/ticketInteractions');
const { updateTicketSettings, resetTicketSettings, updateKnowledgeSettings } = require('../utils/settings');
const { formatUptime, siteUrl } = require('../utils/format');
const { log } = require('../utils/logger');
const { version } = require('../../package.json');

const SECTIONS = [
  { id: 'tickets', label: 'Tickets', emoji: '🎫', description: 'Panels, stats, channels and auto-close', staffOnly: true },
  { id: 'panels', label: 'Panels', emoji: '🧩', description: 'Create and manage every panel', staffOnly: true },
  { id: 'giveaways', label: 'Giveaways', emoji: '🎉', description: 'Create, end, reroll and delete', staffOnly: true },
  { id: 'welcome', label: 'Welcome', emoji: '👋', description: 'Join/leave messages, DM and auto roles', staffOnly: true },
  { id: 'rules', label: 'Rules', emoji: '📜', description: 'Post and edit the rules panel', staffOnly: true },
  { id: 'announce', label: 'Announcements', emoji: '📣', description: 'Post a branded announcement', staffOnly: true },
  { id: 'moderation', label: 'Moderation', emoji: '🛡️', description: 'Timeout, kick, ban, purge, slowmode', staffOnly: true },
  { id: 'knowledge', label: 'Knowledge', emoji: '📚', description: 'Browse, search, ask and forum settings', staffOnly: false },
  { id: 'payments', label: 'Payments', emoji: '💳', description: 'Buy a plan and review orders', staffOnly: false },
  { id: 'status', label: 'Status', emoji: '🛰️', description: 'Uptime, tickets, giveaways and storage', staffOnly: false },
  { id: 'help', label: 'Help', emoji: '❓', description: 'What the bot can do and where to go', staffOnly: false },
];

function sectionMeta(id) {
  return SECTIONS.find((section) => section.id === id) || null;
}

async function overviewCounts(guildId) {
  const [stats, giveaways, knowledge, panels] = await Promise.all([
    ticketStore.getStats().catch(() => null),
    giveawayStore.listGiveaways({ guildId, activeOnly: true }).catch(() => []),
    knowledgeStore.stats({ guildId }).catch(() => ({ total: 0 })),
    panelStore.listPanels({ guildId }).catch(() => []),
  ]);
  return {
    openTickets: stats?.openTotal ?? 0,
    closedTickets: stats?.closedTotal ?? 0,
    avgRating: stats?.avgRating ?? null,
    giveaways: giveaways.length,
    knowledge: knowledge.total || 0,
    panels: panels.length,
  };
}

async function buildHome(client, guildId) {
  const counts = await overviewCounts(guildId);
  const embed = new EmbedBuilder()
    .setTitle('🎛️ Champ control panel')
    .setColor('#2EC4B6')
    .setDescription(
      'Every feature is a button, menu or modal here — you do not need a slash command. Staff actions check your role when you press them.'
    )
    .addFields(
      { name: '🎫 Open tickets', value: String(counts.openTickets), inline: true },
      { name: '⭐ Rating', value: counts.avgRating ? `${counts.avgRating.toFixed(1)}/5` : '—', inline: true },
      { name: '🎉 Giveaways', value: String(counts.giveaways), inline: true },
      { name: '📚 Knowledge', value: String(counts.knowledge), inline: true },
      { name: '🧩 Panels', value: String(counts.panels), inline: true },
      { name: '💾 Storage', value: ticketStore.isSupabaseActive() ? 'Supabase' : 'JSON volume', inline: true }
    )
    .setFooter({ text: `Champ Client · v${version} · pick a section below` })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId('ctl', 'nav'))
    .setPlaceholder('Open a control panel section...')
    .addOptions(
      SECTIONS.map((section) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(section.label)
          .setValue(section.id)
          .setDescription(section.description)
          .setEmoji(section.emoji)
      )
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'panels', 'new'))
          .setLabel('Post a panel')
          .setEmoji('🧩')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'status', 'refresh'))
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'help'))
          .setLabel('Help')
          .setEmoji('❓')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function postControlPanel(channel, client) {
  const payload = await buildHome(client, channel.guildId);
  const message = await channel.send(payload);
  await controlStore.save(channel.guildId, { channelId: channel.id, messageId: message.id });
  return message;
}

async function refreshControlPanels(client) {
  let refreshed = 0;
  for (const record of controlStore.list()) {
    const guild = client.guilds.cache.get(record.guildId);
    if (!guild) continue;
    try {
      const channel =
        client.channels.cache.get(record.channelId) ||
        (await client.channels.fetch(record.channelId).catch(() => null));
      if (!channel?.isTextBased()) continue;
      const payload = await buildHome(client, record.guildId);
      let message = await channel.messages.fetch(record.messageId).catch(() => null);
      if (message) await message.edit(payload);
      else message = await channel.send(payload);
      await controlStore.save(record.guildId, { channelId: channel.id, messageId: message.id });
      refreshed += 1;
    } catch (err) {
      log.warn('control', `could not refresh the control panel in guild ${record.guildId}: ${err.message}`);
    }
  }
  return refreshed;
}

// ---------------------------------------------------------------------------
// Overview, status and help
// ---------------------------------------------------------------------------

async function overviewView(interaction) {
  const payload = await buildHome(interaction.client, interaction.guildId);
  return view(interaction, payload);
}

async function statusView(interaction) {
  const payload = await misc.status(
    { id: 'control', guildId: interaction.guildId, type: 'status', options: {} },
    { client: interaction.client }
  );
  const components = payload.components || [];
  if (components[0]) {
    components[0].addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'home'))
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return view(interaction, { embeds: payload.embeds, components });
}

function helpView(interaction) {
  const payload = misc.help({ id: 'control', guildId: interaction.guildId, type: 'help', options: {} });
  const components = payload.components || [];
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'home'))
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    )
  );
  return view(interaction, { embeds: payload.embeds, components });
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

async function ticketsView(interaction) {
  const config = getTicketConfig();
  const stats = await ticketStore.getStats().catch(() => null);
  const embed = new EmbedBuilder()
    .setTitle('🎫 Tickets')
    .setColor(config.panel?.color || '#FFC93C')
    .setDescription('Post a ticket panel, watch the queue and change the setup without editing JSON.')
    .addFields(
      { name: 'Open', value: String(stats?.openTotal ?? 0), inline: true },
      { name: 'Closed', value: String(stats?.closedTotal ?? 0), inline: true },
      {
        name: 'Rating',
        value: stats?.avgRating ? `${stats.avgRating.toFixed(1)}/5` : '—',
        inline: true,
      },
      {
        name: 'Category',
        value: config.settings.ticketCategoryId ? `<#${config.settings.ticketCategoryId}>` : 'not set',
        inline: true,
      },
      {
        name: 'Auto-close',
        value: config.settings.autoClose?.enabled
          ? `${config.settings.autoClose.inactiveHours}h`
          : 'off',
        inline: true,
      },
      { name: 'Max open', value: String(config.settings.maxOpenTicketsPerUser || 1), inline: true }
    );

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'post'))
          .setLabel('Post ticket panel')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'stats'))
          .setLabel('Statistics')
          .setEmoji('📊')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'open'))
          .setLabel('Open tickets')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'settings'))
          .setLabel('Settings')
          .setEmoji('⚙️')
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

async function ticketSettingsView(interaction) {
  const config = getTicketConfig();
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('⚙️ Ticket channels')
        .setColor(config.panel?.color || '#FFC93C')
        .setDescription('Pick a channel below. Category, log and transcript are stored on the volume.')
        .addFields(
          {
            name: 'Category',
            value: config.settings.ticketCategoryId ? `<#${config.settings.ticketCategoryId}>` : 'not set',
            inline: true,
          },
          {
            name: 'Log',
            value: config.settings.logChannelId ? `<#${config.settings.logChannelId}>` : 'not set',
            inline: true,
          },
          {
            name: 'Transcript archive',
            value: config.settings.transcriptChannelId
              ? `<#${config.settings.transcriptChannelId}>`
              : 'not set',
            inline: true,
          },
          {
            name: 'Support role',
            value: config.settings.supportRoleId
              ? `<@&${config.settings.supportRoleId}>`
              : config.settings.defaultSupportRoleName || 'by name',
            inline: true,
          }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'set', 'category'))
          .setPlaceholder('Ticket category...')
          .addChannelTypes(ChannelType.GuildCategory)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'set', 'log'))
          .setPlaceholder('Ticket log channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'set', 'transcript'))
          .setPlaceholder('Transcript archive channel...')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'role'))
          .setPlaceholder('Support role...')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'options'))
          .setLabel('Options')
          .setEmoji('🔧')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'main'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function ticketOptionsView(interaction) {
  const config = getTicketConfig();
  const settings = config.settings;
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🔧 Ticket options')
        .setColor(config.panel?.color || '#FFC93C')
        .addFields(
          { name: 'Max open / member', value: String(settings.maxOpenTicketsPerUser || 1), inline: true },
          { name: 'Delete delay', value: `${settings.deleteDelaySeconds ?? 5}s`, inline: true },
          { name: 'Transcript', value: settings.transcriptFormat || 'both', inline: true },
          { name: 'DM transcript', value: settings.sendTranscriptDm === false ? 'off' : 'on', inline: true },
          {
            name: 'Auto-close',
            value: settings.autoClose?.enabled
              ? `${settings.autoClose.warningHours}h warning / ${settings.autoClose.inactiveHours}h close`
              : 'off',
            inline: true,
          }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'format'))
          .setPlaceholder('Transcript format...')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Text + HTML').setValue('both').setEmoji('📄').setDefault(settings.transcriptFormat !== 'txt' && settings.transcriptFormat !== 'html'),
            new StringSelectMenuOptionBuilder().setLabel('HTML only').setValue('html').setEmoji('🌐').setDefault(settings.transcriptFormat === 'html'),
            new StringSelectMenuOptionBuilder().setLabel('Text only').setValue('txt').setEmoji('📝').setDefault(settings.transcriptFormat === 'txt')
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'max'))
          .setLabel('Max open')
          .setEmoji('🔢')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'delay'))
          .setLabel('Delete delay')
          .setEmoji('⏱️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'dm'))
          .setLabel(`DM transcript: ${settings.sendTranscriptDm === false ? 'off' : 'on'}`)
          .setEmoji('✉️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'autoclose'))
          .setLabel(`Auto-close: ${settings.autoClose?.enabled ? 'on' : 'off'}`)
          .setEmoji('⏳')
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'settings'))
          .setLabel('Channels')
          .setEmoji('📁')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'main'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function ticketStatsView(interaction) {
  const config = getTicketConfig();
  const stats = await ticketStore.getStats();
  const typeName = (id) => config.types.find((type) => type.id === id)?.label || id;
  const embed = new EmbedBuilder()
    .setTitle('📊 Ticket statistics')
    .setColor(config.panel?.color || '#FFC93C')
    .addFields(
      { name: 'Open', value: String(stats.openTotal), inline: true },
      { name: 'Closed', value: String(stats.closedTotal), inline: true },
      {
        name: 'Average rating',
        value: stats.avgRating ? `${stats.avgRating.toFixed(1)} ⭐ (${stats.ratingsTotal})` : 'none yet',
        inline: true,
      },
      { name: '24h opened / closed', value: `${stats.openedLast24h} / ${stats.closedLast24h}`, inline: true },
      { name: 'Total', value: String(stats.total), inline: true },
      { name: 'Storage', value: ticketStore.isSupabaseActive() ? 'Supabase' : 'JSON volume', inline: true }
    );
  const openLines = Object.entries(stats.openByType).map(([id, count]) => `${typeName(id)}: **${count}**`);
  embed.addFields({ name: 'Open per type', value: openLines.join('\n') || '—' });
  if (stats.topStaff.length) {
    const lines = stats.topStaff.slice(0, 8).map(([id, count]) => `<@${id}>: **${count}** claims`);
    embed.addFields({ name: '🏆 Top staff', value: lines.join('\n') });
  }
  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'stats'))
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'main'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function openTicketsView(interaction) {
  const tickets = await ticketStore.listOpenTickets();
  const config = getTicketConfig();
  const lines = tickets.slice(0, 20).map((ticket) => {
    const type = config.types.find((candidate) => candidate.id === ticket.typeId);
    return `• <#${ticket.channelId}> — <@${ticket.userId}> · ${type?.label || ticket.typeId}${
      ticket.claimedBy ? ` · claimed by <@${ticket.claimedBy}>` : ''
    }`;
  });
  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('📋 Open tickets')
        .setColor(config.panel?.color || '#FFC93C')
        .setDescription(lines.join('\n') || 'No open tickets right now.')
        .setFooter({ text: `${tickets.length} open` }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'open'))
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'tickets', 'main'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function handleTickets(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];
  if (!requireStaff(interaction)) return;

  if (action === 'main') return ticketsView(interaction);
  if (action === 'post') {
    return view(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('🎫 Post a ticket panel')
          .setColor('#FFC93C')
          .setDescription('Choose the channel for the support dropdown. The panel keeps working after restarts.'),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(buildId('ctl', 'tickets', 'post-channel'))
            .setPlaceholder('Channel for the ticket panel...')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        ),
      ],
    });
  }
  if (action === 'post-channel' && interaction.isChannelSelectMenu()) {
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel?.isTextBased()) return view(interaction, { content: '❌ Pick a text channel.' });
    const panel = await panelStore.createPanel({
      guildId: interaction.guildId,
      type: 'tickets',
      name: 'Support tickets',
      channelId: channel.id,
      createdBy: interaction.user.id,
    });
    const message = await postPanel(interaction.client, panel);
    return view(interaction, {
      content: `✅ Ticket panel posted in ${channel}: ${message.url}\nManage every panel under **Panels**.`,
    });
  }
  if (action === 'stats') return ticketStatsView(interaction);
  if (action === 'open') return openTicketsView(interaction);
  if (action === 'settings') return ticketSettingsView(interaction);
  if (action === 'options') return ticketOptionsView(interaction);
  if (action === 'set' && interaction.isChannelSelectMenu()) {
    const field =
      arg === 'category' ? 'ticketCategoryId' : arg === 'log' ? 'logChannelId' : 'transcriptChannelId';
    await updateTicketSettings({ settings: { [field]: interaction.values[0] } });
    return ticketSettingsView(interaction);
  }
  if (action === 'role' && interaction.isRoleSelectMenu()) {
    const role = interaction.guild.roles.cache.get(interaction.values[0]);
    if (!role || role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Pick a normal role.', ephemeral: true });
    }
    await updateTicketSettings({ settings: { supportRoleId: role.id } });
    return ticketSettingsView(interaction);
  }
  if (action === 'max') {
    const modal = new (require('discord.js').ModalBuilder)()
      .setCustomId(buildId('ctl', 'tickets', 'max-modal'))
      .setTitle('Max open tickets per member');
    const input = new (require('discord.js').TextInputBuilder)()
      .setCustomId('value')
      .setLabel('Whole number 1–10')
      .setStyle(require('discord.js').TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(2)
      .setValue(String(getTicketConfig().settings.maxOpenTicketsPerUser || 1));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
  if (action === 'delay') {
    const modal = new (require('discord.js').ModalBuilder)()
      .setCustomId(buildId('ctl', 'tickets', 'delay-modal'))
      .setTitle('Ticket delete delay');
    const input = new (require('discord.js').TextInputBuilder)()
      .setCustomId('value')
      .setLabel('Seconds before the channel is deleted (0–120)')
      .setStyle(require('discord.js').TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue(String(getTicketConfig().settings.deleteDelaySeconds ?? 5));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
  if (action === 'max-modal' && interaction.isModalSubmit()) {
    const value = Number(interaction.fields.getTextInputValue('value'));
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return interaction.reply({ content: '❌ Max open tickets must be 1–10.', ephemeral: true });
    }
    await updateTicketSettings({ settings: { maxOpenTicketsPerUser: value } });
    return ticketOptionsView(interaction);
  }
  if (action === 'delay-modal' && interaction.isModalSubmit()) {
    const value = Number(interaction.fields.getTextInputValue('value'));
    if (!Number.isInteger(value) || value < 0 || value > 120) {
      return interaction.reply({ content: '❌ Delete delay must be 0–120 seconds.', ephemeral: true });
    }
    await updateTicketSettings({ settings: { deleteDelaySeconds: value } });
    return ticketOptionsView(interaction);
  }
  if (action === 'format' && interaction.isStringSelectMenu()) {
    await updateTicketSettings({ settings: { transcriptFormat: interaction.values[0] } });
    return ticketOptionsView(interaction);
  }
  if (action === 'dm') {
    const settings = getTicketConfig().settings;
    await updateTicketSettings({ settings: { sendTranscriptDm: settings.sendTranscriptDm === false } });
    return ticketOptionsView(interaction);
  }
  if (action === 'autoclose') {
    const auto = getTicketConfig().settings.autoClose || {};
    await updateTicketSettings({ settings: { autoClose: { ...auto, enabled: !auto.enabled } } });
    return ticketOptionsView(interaction);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

async function panelsView(interaction) {
  const panels = await panelStore.listPanels({ guildId: interaction.guildId });
  const rows = [];
  if (panels.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'panels', 'open'))
          .setPlaceholder('Open a panel...')
          .addOptions(
            panels.slice(0, 25).map((panel) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(panel.name, 100))
                .setValue(panel.id)
                .setDescription(`${PANEL_TYPES[panel.type]?.label || panel.type} · ${panel.messageId ? 'posted' : 'not posted'}`.slice(0, 100))
                .setEmoji(PANEL_TYPES[panel.type]?.emoji || '🧩')
            )
          )
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'panels', 'new'))
        .setLabel('New panel')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'home'))
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return view(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🧩 Panels')
        .setColor('#2EC4B6')
        .setDescription(
          panels.length
            ? 'Every panel is stored and refreshed on restart. You can run several ticket, knowledge, payment or other panels at the same time.'
            : 'No panels yet. Create one and post it to a channel.'
        )
        .setFooter({ text: `${panels.length} panel(s)` })
    ],
    components: rows,
  });
}

async function panelDetail(interaction, id) {
  const panel = await panelStore.getPanel(id);
  if (!panel || panel.guildId !== interaction.guildId) {
    return view(interaction, { content: 'That panel no longer exists.' });
  }
  const meta = PANEL_TYPES[panel.type] || { label: panel.type, emoji: '🧩' };
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji || '🧩'} ${panel.name}`)
    .setColor('#2EC4B6')
    .addFields(
      { name: 'Type', value: meta.label || panel.type, inline: true },
      { name: 'Channel', value: panel.channelId ? `<#${panel.channelId}>` : '—', inline: true },
      { name: 'Message', value: panel.messageId ? 'posted' : 'not posted', inline: true }
    )
    .setFooter({ text: `Panel ${panel.id}` });

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'panels', 'refresh', panel.id))
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'panels', 'repost', panel.id))
          .setLabel('Post again')
          .setEmoji('📤')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'panels', 'delete', panel.id))
          .setLabel('Delete')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'panels', 'list'))
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function handlePanels(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  const arg = parts[3];
  if (!requireStaff(interaction)) return;

  if (action === 'list' || action === 'back') return panelsView(interaction);
  if (action === 'new') {
    return view(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('🧩 New panel')
          .setColor('#2EC4B6')
          .setDescription('Choose what the panel should do. You can create as many as you want.'),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(buildId('ctl', 'panels', 'type'))
            .setPlaceholder('Panel type...')
            .addOptions(
              Object.entries(PANEL_TYPES).map(([type, meta]) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(meta.label)
                  .setValue(type)
                  .setDescription(meta.description)
                  .setEmoji(meta.emoji)
              )
            )
        ),
      ],
    });
  }
  if (action === 'type' && interaction.isStringSelectMenu()) {
    const type = interaction.values[0];
    const meta = PANEL_TYPES[type];
    if (!meta) return interaction.reply({ content: 'Unknown panel type.', ephemeral: true });
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const modal = new ModalBuilder()
      .setCustomId(buildId('ctl', 'panels', 'new-modal', type))
      .setTitle(`New ${meta.label}`.slice(0, 45));
    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Panel name (shown in the manager)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setValue(meta.label);
    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Embed title (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);
    const description = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Embed description (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1500);
    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description)
    );
    return interaction.showModal(modal);
  }
  if (action === 'new-modal' && interaction.isModalSubmit()) {
    const type = arg;
    if (!PANEL_TYPES[type]) return interaction.reply({ content: 'Unknown panel type.', ephemeral: true });
    flows().set(interaction.user.id, 'panel', {
      type,
      name: interaction.fields.getTextInputValue('name').trim(),
      title: interaction.fields.getTextInputValue('title').trim(),
      description: interaction.fields.getTextInputValue('description').trim(),
    });
    return view(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('🧩 Where should the panel go?')
          .setColor('#2EC4B6')
          .setDescription(`**${PANEL_TYPES[type].label}**\nChoose a text channel.`),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(buildId('ctl', 'panels', 'channel'))
            .setPlaceholder('Panel channel...')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        ),
      ],
    });
  }
  if (action === 'channel' && interaction.isChannelSelectMenu()) {
    const draft = flows().get(interaction.user.id, 'panel');
    if (!draft) return view(interaction, { content: 'That draft expired. Start again.' });
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel?.isTextBased()) return view(interaction, { content: '❌ Pick a text channel.' });
    const panel = await panelStore.createPanel({
      guildId: interaction.guildId,
      type: draft.type,
      name: draft.name || PANEL_TYPES[draft.type].label,
      channelId: channel.id,
      createdBy: interaction.user.id,
      options: {
        ...(draft.title ? { title: draft.title } : {}),
        ...(draft.description ? { description: draft.description } : {}),
      },
    });
    flows().clear(interaction.user.id, 'panel');
    const message = await postPanel(interaction.client, panel);
    return view(interaction, {
      content: `✅ **${panel.name}** posted in ${channel}: ${message.url}`,
      embeds: [
        new EmbedBuilder()
          .setTitle('🧩 Panel created')
          .setColor('#22C55E')
          .addFields(
            { name: 'Type', value: PANEL_TYPES[panel.type].label, inline: true },
            { name: 'Channel', value: `${channel}`, inline: true }
          ),
      ],
    });
  }
  if (action === 'open' && interaction.isStringSelectMenu()) {
    return panelDetail(interaction, interaction.values[0]);
  }
  if (action === 'refresh' || action === 'repost') {
    const panel = await panelStore.getPanel(arg);
    if (!panel || panel.guildId !== interaction.guildId) {
      return view(interaction, { content: 'That panel no longer exists.' });
    }
    const message = await postPanel(interaction.client, panel, { force: action === 'repost' });
    return view(interaction, { content: `✅ Panel refreshed: ${message.url}` });
  }
  if (action === 'delete') {
    const panel = await panelStore.getPanel(arg);
    if (!panel || panel.guildId !== interaction.guildId) {
      return view(interaction, { content: 'That panel no longer exists.' });
    }
    await deletePanelMessage(interaction.client, panel);
    await panelStore.deletePanel(panel.id);
    return panelsView(interaction);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Knowledge and payments sections
// ---------------------------------------------------------------------------

async function knowledgeSection(interaction) {
  const config = getKnowledgeConfig();
  const stats = await knowledgeStore.stats({ guildId: interaction.guildId }).catch(() => ({ total: 0 }));
  const embed = new EmbedBuilder()
    .setTitle('📚 Knowledge')
    .setColor(config.color || '#2EC4B6')
    .setDescription(
      'The forum is the editor: every thread becomes a searchable entry. There is no command that adds knowledge.'
    )
    .addFields(
      { name: 'Entries', value: String(stats.total || 0), inline: true },
      { name: 'Forum', value: config.forumChannelId ? `<#${config.forumChannelId}>` : 'not set', inline: true },
      {
        name: 'Questions',
        value: config.allowPublicQuestions === false ? 'closed' : 'open',
        inline: true,
      },
      {
        name: 'Last sync',
        value: stats.lastSyncAt ? `<t:${Math.floor(new Date(stats.lastSyncAt).getTime() / 1000)}:R>` : 'never',
        inline: true,
      }
    );

  return view(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(buildId('ctl', 'knowledge', 'forum'))
          .setPlaceholder('Knowledge forum channel...')
          .addChannelTypes(ChannelType.GuildForum)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('kb:browse:control')
          .setLabel('Browse')
          .setEmoji('📚')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('kb:search:control')
          .setLabel('Search')
          .setEmoji('🔎')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('kb:ask:control')
          .setLabel('Ask a question')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'knowledge', 'toggle'))
          .setLabel(config.allowPublicQuestions === false ? 'Open questions' : 'Close questions')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('ctl', 'knowledge', 'sync'))
          .setLabel('Sync forum')
          .setEmoji('📥')
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

async function handleKnowledgeSection(interaction) {
  const parts = parseId(interaction.customId);
  const action = parts[2];
  if (action === 'forum' && interaction.isChannelSelectMenu()) {
    if (!requireStaff(interaction)) return;
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      return view(interaction, { content: '❌ Pick a forum channel.' });
    }
    await updateKnowledgeSettings({ forumChannelId: channel.id });
    return knowledgeSection(interaction);
  }
  if (action === 'toggle') {
    if (!requireStaff(interaction)) return;
    const config = getKnowledgeConfig();
    await updateKnowledgeSettings({ allowPublicQuestions: config.allowPublicQuestions === false });
    return knowledgeSection(interaction);
  }
  if (action === 'sync') {
    if (!requireStaff(interaction)) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const result = await syncForum(interaction.guild);
    return interaction.editReply({
      content: result.reason
        ? `❌ ${result.reason}. Set the forum channel first.`
        : `✅ Indexed **${result.synced}** thread(s).`,
    });
  }
  return false;
}

async function paymentsSection(interaction) {
  const config = getPaymentConfig();
  const embed = new EmbedBuilder()
    .setTitle('💳 Payments')
    .setColor(config.color || '#FFC93C')
    .setDescription(
      'Buy inside Discord with crypto, DonutSMP money or a gift card. Staff can approve or reject orders from the queue.'
    )
    .addFields(
      ...['weekly', 'monthly', 'lifetime'].map((id) => {
        const plan = config.plans?.[id] || {};
        return {
          name: `${plan.label || id} · ${plan.price || ''}`.trim(),
          value: plan.description || (plan.days ? `${plan.days} days` : 'One payment'),
          inline: true,
        };
      })
    );

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('pay:plans')
        .setLabel('Buy a plan')
        .setEmoji('💳')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('pay:orders')
        .setLabel('My orders')
        .setEmoji('🧾')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('pay:methods')
        .setLabel('Payment methods')
        .setEmoji('💳')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
  if (staff(interaction.member, interaction.guild)) {
    components[0].addComponents(
      new ButtonBuilder()
        .setCustomId('pay:queue')
        .setLabel('Payment queue')
        .setEmoji('🧮')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('ctl', 'home'))
        .setLabel('Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('Website pricing')
        .setURL(`${siteUrl()}/index.html#pricing`)
        .setStyle(ButtonStyle.Link)
    )
  );
  return view(interaction, { embeds: [embed], components });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function flows() {
  return require('./flows');
}

async function showSection(interaction, sectionId) {
  const meta = sectionMeta(sectionId);
  if (!meta) return interaction.reply({ content: 'Unknown section.', ephemeral: true });
  if (meta.staffOnly && !staff(interaction.member, interaction.guild)) {
    return interaction.reply({ content: '❌ That section is staff only.', ephemeral: true });
  }
  switch (sectionId) {
    case 'tickets':
      return ticketsView(interaction);
    case 'panels':
      return panelsView(interaction);
    case 'giveaways':
      return actions.giveawaysView(interaction);
    case 'welcome':
      return actions.welcomeView(interaction);
    case 'rules':
      return actions.rulesView(interaction);
    case 'announce':
      return actions.announceView(interaction);
    case 'moderation':
      return actions.moderationView(interaction);
    case 'knowledge':
      return knowledgeSection(interaction);
    case 'payments':
      return paymentsSection(interaction);
    case 'status':
      return statusView(interaction);
    case 'help':
      return helpView(interaction);
    default:
      return overviewView(interaction);
  }
}

async function handleControl(interaction) {
  const parts = parseId(interaction.customId);
  if (parts[0] !== 'ctl') return false;
  const section = parts[1];
  const action = parts[2];

  if (section === 'nav' && interaction.isStringSelectMenu()) {
    return showSection(interaction, interaction.values[0]);
  }
  if (section === 'home' || section === 'overview') {
    if (section === 'overview' && action === 'refresh') {
      return overviewView(interaction);
    }
    return overviewView(interaction);
  }
  if (section === 'tickets') return handleTickets(interaction);
  if (section === 'panels') return handlePanels(interaction);
  if (section === 'giveaway') return actions.handleGiveaway(interaction);
  if (section === 'welcome') return actions.handleWelcome(interaction);
  if (section === 'rules') return actions.handleRules(interaction);
  if (section === 'announce') return actions.handleAnnounce(interaction);
  if (section === 'mod') return actions.handleModeration(interaction);
  if (section === 'knowledge') return handleKnowledgeSection(interaction);
  if (section === 'status') {
    if (action === 'refresh') return statusView(interaction);
    return statusView(interaction);
  }
  if (section === 'help') return helpView(interaction);
  if (section === 'payments') return paymentsSection(interaction);
  return false;
}

// Persistent panel buttons: ticket dropdown, giveaway wizard, welcome actions, status refresh.
async function handlePanel(interaction) {
  const parts = parseId(interaction.customId);
  if (parts[0] !== 'panel') return false;
  const panelId = parts[1];
  const action = parts[2];
  if (!action) return false;
  if (String(action).startsWith('kb-')) return knowledgeInteractions.handleKnowledge(interaction);
  if (String(action).startsWith('pay-')) return paymentInteractions.handlePayment(interaction);
  if (panelId === 'control' && action === 'status-live') return statusView(interaction);

  if (panelId === 'control') return false;
  const panel = await panelStore.getPanel(panelId);
  if (!panel) {
    return interaction
      .reply({ content: 'This panel was removed. Ask staff to post a new one.', ephemeral: true })
      .catch(() => {});
  }
  if (panel.guildId && interaction.guildId && panel.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'This panel belongs to another server.', ephemeral: true }).catch(() => {});
  }

  if (action === 'ticket' && interaction.isStringSelectMenu()) {
    return ticketInteractions.handleSelect(interaction);
  }
  if (action === 'giveaway-create') {
    if (!requireStaff(interaction)) return true;
    return interaction.showModal(actions.giveawayModal());
  }
  if (action === 'giveaway-list') {
    if (!requireStaff(interaction)) return true;
    return actions.giveawayList(interaction);
  }
  if (action === 'welcome-preview') return actions.welcomePreview(interaction);
  if (action === 'welcome-test') {
    if (!requireStaff(interaction)) return true;
    return actions.welcomeTest(interaction);
  }
  if (action === 'welcome-settings') {
    if (!requireStaff(interaction)) return true;
    return actions.welcomeSettingsView(interaction);
  }
  if (action === 'status-live') {
    const payload = await renderPanel(panel, { client: interaction.client, guild: interaction.guild });
    return view(interaction, { embeds: payload.embeds, components: payload.components });
  }
  return false;
}

module.exports = {
  SECTIONS,
  buildHome,
  postControlPanel,
  refreshControlPanels,
  handleControl,
  handlePanel,
  showSection,
  overviewView,
  formatUptime,
};
