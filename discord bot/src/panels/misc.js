const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildRulesPayload } = require('../utils/rules');
const { getRulesConfig } = require('../utils/ruleSettings');
const { getWelcomeConfig } = require('../utils/welcomeSettings');
const { formatUptime, siteUrl, inviteUrl } = require('../utils/format');
const ticketStore = require('../utils/ticketStore');
const giveawayStore = require('../utils/giveawayStore');
const knowledgeStore = require('../knowledge/knowledgeStore');
const { buildId } = require('../core/ids');
const { version } = require('../../package.json');

function rules(panel) {
  return buildRulesPayload(getRulesConfig());
}

async function welcome(panel) {
  const config = getWelcomeConfig();
  const embed = new EmbedBuilder()
    .setTitle(panel.options?.title || '👋 Welcome to Champ')
    .setDescription(
      panel.options?.description ||
        'New members get a welcome message, auto roles and a DM with the download and dashboard links. Staff can preview and change everything from here.'
    )
    .setColor(panel.options?.color || config.embed?.color || '#FFC93C')
    .addFields(
      { name: 'Welcome', value: config.enabled ? 'enabled' : 'disabled', inline: true },
      {
        name: 'Channel',
        value: config.channelId ? `<#${config.channelId}>` : 'automatic',
        inline: true,
      },
      { name: 'Welcome DM', value: config.dm?.enabled ? 'on' : 'off', inline: true },
      {
        name: 'Auto roles',
        value: config.autoRoles?.length ? config.autoRoles.map((id) => `<@&${id}>`).join(', ') : 'none',
      }
    )
    .setFooter({ text: 'Champ Client · welcome' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'welcome-preview'))
      .setLabel('Preview')
      .setEmoji('👀')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'welcome-test'))
      .setLabel('Send test')
      .setEmoji('📨')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'welcome-settings'))
      .setLabel('Settings')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

async function status(panel, context = {}) {
  const client = context.client;
  const [tickets, giveaways, knowledge] = await Promise.all([
    ticketStore.getStats().catch(() => null),
    giveawayStore.listGiveaways({ activeOnly: true }).catch(() => []),
    knowledgeStore.stats({ guildId: panel.guildId }).catch(() => ({ total: 0 })),
  ]);
  const startedAt = client?.startedAt || Date.now();

  const embed = new EmbedBuilder()
    .setTitle(panel.options?.title || '🛰️ Champ status')
    .setColor(panel.options?.color || '#2EC4B6')
    .addFields(
      { name: 'Uptime', value: formatUptime(Date.now() - startedAt), inline: true },
      { name: 'Ping', value: `${Math.max(0, Math.round(client?.ws?.ping ?? 0))} ms`, inline: true },
      { name: 'Servers', value: String(client?.guilds?.cache?.size ?? '—'), inline: true },
      { name: 'Open tickets', value: String(tickets?.openTotal ?? '—'), inline: true },
      { name: 'Giveaways', value: String(giveaways.length), inline: true },
      { name: 'Knowledge entries', value: String(knowledge.total || 0), inline: true },
      { name: 'Storage', value: ticketStore.isSupabaseActive() ? 'Supabase' : 'JSON volume', inline: true },
      { name: 'Version', value: `v${version}`, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'status-live'))
      .setLabel('Refresh status')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Website').setURL(siteUrl()).setStyle(ButtonStyle.Link)
  );

  return { embeds: [embed], components: [row] };
}

function help(panel) {
  const embed = new EmbedBuilder()
    .setTitle(panel.options?.title || 'Champ bot · help')
    .setDescription(
      panel.options?.description ||
        'Tickets, giveaways, knowledge, payments, welcome and moderation all work from the control panel. Slash commands are shortcuts for the same actions.'
    )
    .setColor(panel.options?.color || '#2EC4B6')
    .addFields(
      {
        name: '🎫 Tickets',
        value: 'Open a ticket with the dropdown on a ticket panel. Staff claim, export and close from the ticket buttons.',
      },
      {
        name: '📚 Knowledge',
        value: 'Browse or search the knowledge panel. Ask a question there and it becomes a forum thread.',
      },
      {
        name: '💳 Payments',
        value: 'Choose a plan in the payment panel. Crypto, DonutSMP and gift cards are handled inside Discord.',
      },
      {
        name: '🔗 Account',
        value: `Link Discord on ${siteUrl()}/dashboard.html with \`/link code:<code>\` so purchases land on your account.`,
      }
    )
    .setFooter({ text: 'Champ Client · support and community' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Website').setURL(siteUrl()).setStyle(ButtonStyle.Link),
    new ButtonBuilder().setLabel('Dashboard').setURL(`${siteUrl()}/dashboard.html`).setStyle(ButtonStyle.Link),
    new ButtonBuilder().setLabel('Discord').setURL(inviteUrl()).setStyle(ButtonStyle.Link)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { rules, welcome, status, help };
