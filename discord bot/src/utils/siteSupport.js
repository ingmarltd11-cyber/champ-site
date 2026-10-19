const fetch = global.fetch;
const DISCORD_INVITE = 'https://discord.gg/ETuFknzhy';

function apiUrl() {
  const base = process.env.SUPPORT_API_URL || process.env.SITE_URL;
  return base ? `${base.replace(/\/$/, '')}/api/ai/chat` : null;
}

async function handleSupportMessage(message, ticket) {
  if (!ticket || !message.mentions.has(message.client.user)) return;

  const endpoint = apiUrl();
  if (!endpoint) {
    await message.reply(`Shared AI support is not configured yet. Please open a ticket with our team: ${DISCORD_INVITE}`);
    return;
  }

  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!question) {
    await message.reply('Please mention me with a description of the issue and what you have already tried.');
    return;
  }

  await message.channel.sendTyping();
  const sessionId = message.channel.id;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question.slice(0, 2000), channel: 'discord', session_id: sessionId }),
      signal: AbortSignal.timeout(22000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.reply) throw new Error(`Support endpoint returned ${response.status}`);

    const reply = String(data.reply).slice(0, 1800);
    if (data.needs_escalation) {
      await message.reply(`${reply}\n\nA teammate can take over here: ${DISCORD_INVITE}`);
    } else {
      await message.reply(reply);
    }
  } catch (error) {
    console.error('Shared support AI request failed:', error.message);
    await message.reply(`I couldn't reach the support assistant just now. Please try again or open a ticket with the team: ${DISCORD_INVITE}`);
  }
}

module.exports = { handleSupportMessage };
