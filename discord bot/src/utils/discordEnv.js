// Discord deployments use two names for the same values: Railway traditionally exposes
// DISCORD_TOKEN / CLIENT_ID / GUILD_ID, while the Vercel site uses DISCORD_BOT_TOKEN /
// DISCORD_CLIENT_ID / DISCORD_GUILD_ID. Accept both so one set of variables can serve both.
function first(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function discordToken(env = process.env) {
  return first(env, ['DISCORD_TOKEN', 'DISCORD_BOT_TOKEN']);
}

function applicationId(env = process.env) {
  return first(env, ['CLIENT_ID', 'DISCORD_CLIENT_ID']);
}

function guildId(env = process.env) {
  return first(env, ['GUILD_ID', 'DISCORD_GUILD_ID']);
}

module.exports = { discordToken, applicationId, guildId };
