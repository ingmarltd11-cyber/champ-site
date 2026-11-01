const { EmbedBuilder } = require('discord.js');

// Every ticket action lands in the configured log channel, if there is one. Logging must never
// break the action itself, so failures are swallowed and printed.
async function logTicketEvent(guild, config, { title, color, fields = [] }) {
  const channelId = config?.settings?.logChannelId;
  if (!guild || !channelId || String(channelId).includes('_ID')) return;
  try {
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId));
    if (!channel?.isTextBased()) return;
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setColor(color || config?.panel?.color || '#FFC93C')
          .addFields(fields)
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.error('[ticket-log] could not post:', err.message);
  }
}

module.exports = { logTicketEvent };
