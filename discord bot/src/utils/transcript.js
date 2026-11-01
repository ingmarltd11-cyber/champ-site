const { AttachmentBuilder } = require('discord.js');

const MAX_MESSAGES = 1000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function messageLine(message) {
  const time = message.createdAt ? new Date(message.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '';
  const author = message.author?.tag || message.author?.username || 'unknown';
  const text = message.content || '';
  const attachments = message.attachments?.size
    ? ` [attachments: ${[...message.attachments.values()].map((a) => a.url).join(', ')}]`
    : '';
  return `[${time}] ${author}: ${text}${attachments}`;
}

// Fetch the whole conversation and return ready-to-send transcript attachments plus the plain
// text stored with the ticket. format: 'txt' | 'html' | 'both'.
async function generateTranscripts(channel, format = 'both') {
  const collected = [];
  let before;
  while (collected.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, MAX_MESSAGES - collected.length),
      before,
    });
    if (!batch.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  collected.reverse();

  const lines = collected.map(messageLine);
  const text = lines.join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Transcript #${escapeHtml(channel.name)}</title>
<style>
body{background:#111;color:#eee;font:14px/1.5 system-ui,sans-serif;margin:32px}
h1{color:#FFC93C;font-size:20px}
pre{white-space:pre-wrap;word-break:break-word;background:#181818;border:1px solid #2a2a2a;border-radius:10px;padding:16px}
</style></head>
<body><h1>#${escapeHtml(channel.name)}</h1>
<p>${collected.length} messages · exported ${new Date().toISOString()}</p>
<pre>${escapeHtml(text)}</pre></body></html>`;

  const safeName = String(channel.name || 'ticket').replace(/[^a-z0-9-]/gi, '-').slice(0, 60);
  const txt =
    format === 'html'
      ? null
      : new AttachmentBuilder(Buffer.from(text || 'No messages.', 'utf8'), {
          name: `${safeName}.txt`,
        });
  const htmlFile =
    format === 'txt'
      ? null
      : new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${safeName}.html` });

  return { txt, html: htmlFile, text };
}

module.exports = { generateTranscripts, escapeHtml };
