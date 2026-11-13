const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require('discord.js');

const { log, setClient, reportError } = require('./utils/logger');
const { checkEnv, validateTicketConfig, validateGiveawayConfig, auditGuild } = require('./utils/preflight');
const { getTicketConfig, getGiveawayConfig, getWelcomeDefaults } = require('./config/loadConfig');
const { getWelcomeConfig } = require('./utils/welcomeSettings');
const { siteUrl, inviteUrl } = require('./utils/format');
const ticketStore = require('./utils/ticketStore');
const { startAutoClose } = require('./jobs/autoClose');
const { startGiveawayScheduler } = require('./jobs/giveawayScheduler');
const giveawayInteractions = require('./handlers/giveawayInteractions');
const welcomeEvents = require('./handlers/welcomeEvents');
const ticketInteractions = require('./handlers/ticketInteractions');
const { startHealthServer } = require('./health');
const { registerCommands } = require('./deploy-commands');

const env = checkEnv();
env.warnings.forEach((warning) => log.warn('env', warning));
if (env.errors.length) {
  env.errors.forEach((error) => log.error('env', error));
  process.exit(1);
}

const ticketConfig = getTicketConfig();
const giveawayConfig = getGiveawayConfig();
const welcomeConfig = getWelcomeDefaults();
for (const [name, result] of [
  ['tickets', validateTicketConfig(ticketConfig)],
  ['giveaway', validateGiveawayConfig(giveawayConfig)],
]) {
  result.warnings.forEach((warning) => log.warn(`config:${name}`, warning));
  if (result.errors.length) {
    result.errors.forEach((error) => log.error(`config:${name}`, error));
    process.exit(1);
  }
}

const startedAt = Date.now();
const supportCooldowns = new Map();
let shuttingDown = false;
let health = null;
let stopAutoClose = null;
let stopGiveaways = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});
client.startedAt = startedAt;
setClient(client);

client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data && command?.execute) client.commands.set(command.data.name, command);
}

function replyError(interaction, message) {
  if (!interaction || interaction.isAutocomplete?.()) return Promise.resolve();
  const payload = { content: message, ephemeral: true };
  try {
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function actionName(interaction) {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isButton() || interaction.isStringSelectMenu()) return interaction.customId;
  if (interaction.isModalSubmit()) return interaction.customId;
  return 'interaction';
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return replyError(interaction, 'This command is no longer available. Try again in a moment.');
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('ticket-rate:')) return ticketInteractions.handleRateButton(interaction);
      if (id === 'ticket-claim') return ticketInteractions.handleClaim(interaction);
      if (id === 'ticket-close') return ticketInteractions.handleClose(interaction);
      if (id === 'ticket-transcript') return ticketInteractions.handleTranscript(interaction);
      if (id.startsWith('giveaway:')) return giveawayInteractions.handleGiveawayButton(interaction);
      return replyError(interaction, 'This button is out of date. Run `/ticket-panel` again if the panel is broken.');
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket-select') return ticketInteractions.handleSelect(interaction);
      return replyError(interaction, 'This menu is out of date. Run `/ticket-panel` again.');
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket-rate-modal:')) {
        return ticketInteractions.handleRateModal(interaction);
      }
      if (interaction.customId.startsWith('ticket-modal-')) {
        return ticketInteractions.handleModalSubmit(interaction);
      }
    }
  } catch (err) {
    await reportError('interaction', err, {
      action: actionName(interaction),
      userTag: interaction.user?.tag,
      guildName: interaction.guild?.name,
      channelId: interaction.channelId,
    });
    await replyError(interaction, 'Something went wrong. Please try again or open a ticket.');
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author?.bot) return;
  try {
    const ticket = await ticketStore.getTicket(message.channelId);
    if (ticket) {
      const last = new Date(ticket.lastActivityAt).getTime();
      if (ticket.warned || !Number.isFinite(last) || Date.now() - last > 60 * 1000) {
        await ticketStore.touchTicket(message.channelId);
      }
    }
    if (client.user && message.mentions.has(client.user)) {
      // Support mentions are deliberately not answered by an AI. Point the member at the
      // dashboard/ticket flow, with a short cooldown so a mention cannot be used to spam.
      const now = Date.now();
      for (const [id, at] of supportCooldowns) if (now - at > 60000) supportCooldowns.delete(id);
      if (!supportCooldowns.has(message.author.id)) {
        supportCooldowns.set(message.author.id, now);
        await message.reply({
          content: `Need a hand? Link your Discord on the dashboard (${siteUrl()}/dashboard.html), open a ticket here, or ask in ${inviteUrl()}.`,
          allowedMentions: { repliedUser: false },
        });
      }
    }
  } catch (err) {
    log.warn('message', `could not handle a message: ${err.message}`);
  }
});

// A deleted ticket channel must not stay "open" forever in the statistics.
client.on('channelDelete', async (channel) => {
  try {
    if (!channel?.guild) return;
    const ticket = await ticketStore.getTicket(channel.id);
    if (ticket?.status === 'open') {
      await ticketStore.closeTicket(channel.id, {
        transcript: '[The channel was deleted before a transcript could be generated.]',
      });
      log.warn('tickets', `ticket channel ${channel.name} was deleted; record closed without transcript`);
    }
  } catch (err) {
    log.warn('tickets', `could not reconcile a deleted channel: ${err.message}`);
  }
});

client.on('guildMemberAdd', (member) => {
  welcomeEvents
    .onGuildMemberAdd(member)
    .catch((err) => reportError('welcome', err, { action: 'guildMemberAdd', guildName: member.guild?.name }));
});

client.on('guildMemberRemove', (member) => {
  welcomeEvents
    .onGuildMemberRemove(member)
    .catch((err) => reportError('welcome', err, { action: 'guildMemberRemove', guildName: member.guild?.name }));
});

client.on('error', (err) => reportError('gateway', err));
client.on('warn', (message) => log.warn('gateway', message));
client.on('shardError', (err) => reportError('shard', err));

client.once('ready', async () => {
  log.info('boot', `logged in as ${client.user.tag} in ${client.guilds.cache.size} guild(s)`);
  if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) {
    log.warn('welcome', 'Guild Members intent is not enabled; join/leave welcome messages cannot fire.');
  }
  client.user.setPresence({
    activities: [{ name: siteUrl().replace(/^https?:\/\//, ''), type: ActivityType.Watching }],
    status: 'online',
  });

  for (const guild of client.guilds.cache.values()) {
    const warnings = auditGuild(guild, {
      ticketConfig: getTicketConfig(),
      giveawayConfig: getGiveawayConfig(),
      welcomeConfig: getWelcomeConfig(),
    });
    for (const warning of warnings) log.warn('audit', `${guild.name}: ${warning}`);
  }

  if (process.env.AUTO_DEPLOY_COMMANDS !== 'false' && process.env.CLIENT_ID) {
    try {
      const result = await registerCommands({ guildId: process.env.GUILD_ID || null });
      log.info('deploy', `slash commands registered (${result.count}) ${result.scope}`);
    } catch (err) {
      await reportError('deploy', err, { action: 'registerCommands' });
    }
  }

  stopAutoClose = startAutoClose(client);
  stopGiveaways = startGiveawayScheduler(client);
  log.info('boot', `ready in ${Date.now() - startedAt}ms`);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('boot', `${signal} received, shutting down`);
  stopAutoClose?.();
  stopGiveaways?.();
  await health?.close().catch(() => {});
  await client.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  reportError('process', err);
});
process.on('uncaughtException', async (err) => {
  await reportError('process', err);
  setTimeout(() => process.exit(1), 1000);
});

(async () => {
  await ticketStore.init();
  health = startHealthServer({ client, startedAt, isShuttingDown: () => shuttingDown });
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    log.error('boot', `login failed: ${err.message}`);
    await health?.close().catch(() => {});
    process.exit(1);
  }
})();

module.exports = { client };
