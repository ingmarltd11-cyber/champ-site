const { inviteUrl, siteUrl } = require('./format');
const { log } = require('./logger');

// AI support is a first line, never the final word: every answer points at a human when the
// assistant is unsure or the member asks something account-specific.
const cooldowns = new Map();
const COOLDOWN_MS = 8 * 1000;

function apiUrl() {
  const base = process.env.SUPPORT_API_URL || siteUrl();
  return base ? `${base.replace(/\/+$/, '')}/api/ai/chat` : null;
}

async function handleSupportMessage(message, ticket) {
  if (!message.mentions.has(message.client.user)) return;

  const now = Date.now();
  for (const [id, at] of cooldowns) if (now - at > 60000) cooldowns.delete(id);
  if (cooldowns.has(message.author.id) && now - cooldowns.get(message.author.id) < COOLDOWN_MS) {
    return;
  }
  cooldowns.set(message.author.id, now);

  const endpoint = apiUrl();
  if (!endpoint) {
    await message.reply(`Shared support is not configured yet. Open a ticket with the team: ${inviteUrl()}`);
    return;
  }

  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!question) {
    await message.reply(
      'Mention me with a description of the issue and what you have already tried, or open a ticket.'
    );
    return;
  }

  try {
    await message.channel.sendTyping();
  } catch {
    /* Typing is cosmetic. */
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: question.slice(0, 2000),
        channel: 'discord',
        // The website requires a real Discord snowflake for this channel.
        session_id: message.channel.id,
      }),
      signal: AbortSignal.timeout(22000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.reply) throw new Error(`support endpoint returned ${response.status}`);

    const reply = String(data.reply).slice(0, 1800);
    const suffix = `\n\n-# Need a human? ${ticket ? 'A teammate can take over in this ticket.' : `Open a ticket or ask in ${inviteUrl()}`}`;
    await message.reply(data.needs_escalation ? `${reply}${suffix}` : reply);
  } catch (error) {
    log.warn('support', `AI request failed: ${error.message}`);
    await message.reply(
      `I couldn't reach the support assistant just now. Please try again, or open a ticket with the team: ${inviteUrl()}`
    );
  }
}

module.exports = { handleSupportMessage };
