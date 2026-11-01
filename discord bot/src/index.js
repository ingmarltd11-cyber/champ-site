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

const { getTicketConfig } = require('./config/loadConfig');
const ticketStore = require('./utils/ticketStore');
const { handleSupportMessage } = require('./utils/siteSupport');
const { startAutoClose } = require('./jobs/autoClose');
const { startGiveawayScheduler } = require('./jobs/giveawayScheduler');
const giveawayInteractions = require('./handlers/giveawayInteractions');
const welcomeEvents = require('./handlers/welcomeEvents');
const ticketInteractions = require('./handlers/ticketInteractions');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error(
    'DISCORD_TOKEN is missing. Copy .env.example to .env (or set it in Railway) and start again.'
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data && command?.execute) client.commands.set(command.data.name, command);
}

function replyError(interaction, message) {
  const payload = { content: message, ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('ticket-rate:')) {
        await ticketInteractions.handleRateButton(interaction);
        return;
      }
      if (interaction.customId === 'ticket-claim') {
        await ticketInteractions.handleClaim(interaction);
        return;
      }
      if (interaction.customId === 'ticket-close') {
        await ticketInteractions.handleClose(interaction);
        return;
      }
      await giveawayInteractions.handleGiveawayButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket-select') {
        await ticketInteractions.handleSelect(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket-rate-modal:')) {
        await ticketInteractions.handleRateModal(interaction);
        return;
      }
      if (interaction.customId.startsWith('ticket-modal-')) {
        await ticketInteractions.handleModalSubmit(interaction);
      }
    }
  } catch (err) {
    console.error('[interaction] failed:', err);
    await replyError(interaction, 'Something went wrong. Please try again or open a ticket.');
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author?.bot) return;
  try {
    const ticket = await ticketStore.getTicket(message.channelId);
    if (ticket) await ticketStore.touchTicket(message.channelId);
    if (client.user && message.mentions.has(client.user)) {
      await handleSupportMessage(message, ticket);
    }
  } catch (err) {
    console.error('[message] failed:', err.message);
  }
});

client.on('guildMemberAdd', (member) => {
  welcomeEvents.onGuildMemberAdd(member).catch((err) => console.error('[welcome] join failed:', err));
});

client.on('guildMemberRemove', (member) => {
  welcomeEvents.onGuildMemberRemove(member).catch((err) => console.error('[welcome] leave failed:', err));
});

client.once('ready', () => {
  console.log(`[bot] logged in as ${client.user.tag} in ${client.guilds.cache.size} guild(s)`);
  client.user.setActivity('champ-site-psi.vercel.app', { type: ActivityType.Watching });
  startAutoClose(client);
  startGiveawayScheduler(client);
});

process.on('unhandledRejection', (err) => console.error('[bot] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[bot] uncaught exception:', err));

async function shutdown(signal) {
  console.log(`[bot] ${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(token).catch((err) => {
  console.error('[bot] login failed:', err.message);
  process.exit(1);
});

module.exports = { client, getTicketConfig };
