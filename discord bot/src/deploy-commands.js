const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('DISCORD_TOKEN and CLIENT_ID are required to register commands.');
  process.exit(1);
}

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

(async () => {
  try {
    const result = await rest.put(route, { body: commands });
    console.log(
      `[deploy] registered ${result.length} command(s) ${guildId ? `in guild ${guildId}` : 'globally'}: ${result
        .map((c) => c.name)
        .join(', ')}`
    );
  } catch (err) {
    console.error('[deploy] failed:', err);
    process.exit(1);
  }
})();
