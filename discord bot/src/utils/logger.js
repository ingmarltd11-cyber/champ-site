const { EmbedBuilder } = require('discord.js');

// One logger for the whole bot. Levels come from LOG_LEVEL (error | warn | info | debug).
// Errors are also mirrored to ERROR_LOG_CHANNEL_ID, throttled so a loop cannot spam the channel.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const levelName = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const configured = Object.prototype.hasOwnProperty.call(LEVELS, levelName) ? LEVELS[levelName] : LEVELS.info;

let clientRef = null;
const recent = new Map();

function describe(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function line(level, scope, args) {
  const body = args.map(describe).join(' ');
  return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${body}`;
}

const log = {
  debug(scope, ...args) {
    if (configured >= LEVELS.debug) console.log(line('debug', scope, args));
  },
  info(scope, ...args) {
    if (configured >= LEVELS.info) console.log(line('info', scope, args));
  },
  warn(scope, ...args) {
    if (configured >= LEVELS.warn) console.warn(line('warn', scope, args));
  },
  error(scope, ...args) {
    console.error(line('error', scope, args));
  },
};

function setClient(client) {
  clientRef = client;
}

function prune(now) {
  for (const [key, at] of recent) {
    if (now - at > 10 * 60 * 1000) recent.delete(key);
  }
}

// Mirrors an error to the configured channel. Never throws: monitoring must not break the bot.
async function reportError(scope, error, context = {}) {
  log.error(scope, error);
  const channelId = process.env.ERROR_LOG_CHANNEL_ID;
  if (!clientRef || !channelId) return;

  const key = `${scope}:${error instanceof Error ? error.message : String(error)}`;
  const now = Date.now();
  if (recent.has(key) && now - recent.get(key) < 60 * 1000) return;
  recent.set(key, now);
  prune(now);

  try {
    const channel = await clientRef.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const detail = String(error instanceof Error ? error.stack || error.message : error || 'unknown')
      .replace(/\s+/g, ' ')
      .slice(0, 3900);
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Bot error')
      .setColor('#FB7185')
      .setDescription(`\`\`\`\n${detail}\n\`\`\``)
      .setTimestamp()
      .addFields({ name: 'Scope', value: String(scope).slice(0, 256), inline: true });

    if (context.userTag) embed.addFields({ name: 'User', value: String(context.userTag).slice(0, 256), inline: true });
    if (context.guildName) embed.addFields({ name: 'Server', value: String(context.guildName).slice(0, 256), inline: true });
    if (context.action) embed.addFields({ name: 'Action', value: String(context.action).slice(0, 256) });
    if (context.channelId) embed.addFields({ name: 'Channel', value: String(context.channelId).slice(0, 256), inline: true });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.warn('logger', `could not mirror the error to Discord: ${err.message}`);
  }
}

module.exports = { log, setClient, reportError };
