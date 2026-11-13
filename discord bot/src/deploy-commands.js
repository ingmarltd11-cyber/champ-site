const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const { REST, Routes } = require('discord.js');
const { discordToken, applicationId, guildId: configuredGuildId } = require('./utils/discordEnv');

function collectCommands() {
  const commands = [];
  const commandsDir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js'))) {
    const command = require(path.join(commandsDir, file));
    if (command?.data) commands.push(command.data);
  }
  return commands;
}

// Registers every command in src/commands. Called by `npm run deploy` and, unless
// AUTO_DEPLOY_COMMANDS=false, once by the bot itself on ready so a fresh deploy never shows an
// empty slash-command list.
async function registerCommands({
  token = discordToken(),
  clientId = applicationId(),
  guildId = configuredGuildId(),
} = {}) {
  if (!token || !clientId) {
    throw new Error('DISCORD_TOKEN (or DISCORD_BOT_TOKEN) and CLIENT_ID (or DISCORD_CLIENT_ID) are required to register commands.');
  }
  const body = collectCommands().map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  const result = await rest.put(route, { body });
  return {
    count: result.length,
    names: result.map((command) => command.name),
    scope: guildId ? `in guild ${guildId}` : 'globally',
  };
}

async function main() {
  try {
    const result = await registerCommands();
    console.log(`[deploy] registered ${result.count} command(s) ${result.scope}: ${result.names.join(', ')}`);
  } catch (err) {
    console.error('[deploy] failed:', err);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { collectCommands, registerCommands };
