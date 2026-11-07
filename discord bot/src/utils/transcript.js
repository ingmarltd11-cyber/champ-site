const { AttachmentBuilder } = require('discord.js');

const MAX_MESSAGES = 1000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function attachmentsOf(message) {
  if (!message.attachments?.size) return [];
  return [...message.attachments.values()].map((a) => a.url);
}

function messageLine(message) {
  const time = stamp(message.createdAt);
  const author = message.author?.tag || message.author?.username || 'unknown';
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const embed of message.embeds || []) {
    const title = embed.title || embed.description || 'embed';
    parts.push(`[embed: ${String(title).slice(0, 200)}]`);
  }
  const files = attachmentsOf(message);
  if (files.length) parts.push(`[attachments: ${files.join(', ')}]`);
  if (!parts.length) parts.push('[no text]');
  return `[${time}] ${author}: ${parts.join(' ')}`;
}

// Self-contained HTML: no external assets, so a transcript opens years later exactly as saved.
function renderTranscriptHtml({ channel, messages, meta = {} }) {
  const rows = messages
    .map((message) => {
      const author = message.author?.tag || message.author?.username || 'unknown';
      const avatar = message.author?.displayAvatarURL?.({ size: 64 }) || '';
      const body = escapeHtml(message.content || '').replace(/\n/g, '<br>');
      const embeds = (message.embeds || [])
        .map((embed) => {
          const title = escapeHtml(embed.title || 'Embed');
          const text = escapeHtml(embed.description || '');
          return `<div class="embed"><div class="embed-title">${title}</div>${text ? `<div>${text.replace(/\n/g, '<br>')}</div>` : ''}</div>`;
        })
        .join('');
      const files = attachmentsOf(message)
        .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url.split('/').pop() || url)}</a>`)
        .join(' · ');
      return `<article class="msg">
  <img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">
  <div class="body">
    <div class="head"><span class="author">${escapeHtml(author)}</span><time>${escapeHtml(stamp(message.createdAt))}</time></div>
    ${body ? `<div class="text">${body}</div>` : ''}
    ${embeds}
    ${files ? `<div class="files">${files}</div>` : ''}
  </div>
</article>`;
    })
    .join('\n');

  const name = channel?.name || 'ticket';
  const guild = channel?.guild?.name || meta.guildName || '';
  const details = [
    guild ? `Server: ${guild}` : null,
    meta.closedBy ? `Closed by: ${meta.closedBy}` : null,
    meta.reason ? `Reason: ${meta.reason}` : null,
    `${messages.length} messages`,
    `Exported ${stamp(new Date())}`,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>#${escapeHtml(name)} · Champ transcript</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f0d0f; color: #eceaec; font: 14px/1.55 'Segoe UI', system-ui, sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 40px 22px 80px; }
  header { border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 20px; margin-bottom: 26px; }
  .brand { color: #2ec4b6; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; }
  h1 { font-size: 22px; margin: 6px 0 10px; }
  .meta { color: #8f8a90; font-size: 12.5px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .msg { display: flex; gap: 12px; padding: 10px 12px; border-radius: 10px; }
  .msg:hover { background: rgba(255,255,255,.035); }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #1c1a1c; flex: 0 0 auto; }
  .body { min-width: 0; flex: 1; }
  .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .author { font-weight: 600; color: #fff; }
  time { color: #6f6a70; font-size: 11.5px; font-family: ui-monospace, monospace; }
  .text { white-space: normal; overflow-wrap: anywhere; color: #dcd8dc; }
  .embed { border-left: 3px solid #2ec4b6; background: #171517; padding: 8px 12px; border-radius: 6px; margin: 6px 0; color: #cfcacf; }
  .embed-title { font-weight: 600; color: #fff; margin-bottom: 2px; }
  .files { font-size: 12px; margin-top: 4px; }
  .files a { color: #37c9bb; }
  footer { margin-top: 34px; color: #6f6a70; font-size: 12px; text-align: center; }
</style></head>
<body><div class="wrap">
  <header>
    <div class="brand">Champ Client · support transcript</div>
    <h1>#${escapeHtml(name)}</h1>
    <div class="meta">${details.map((d) => `<span>${escapeHtml(d)}</span>`).join('')}</div>
  </header>
  ${rows || '<p>No messages in this ticket.</p>'}
  <footer>Saved by the Champ Discord bot. Links may expire; the text above does not.</footer>
</div></body></html>`;
}

function safeName(channel) {
  return String(channel?.name || 'ticket')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// Fetch the whole conversation and return ready-to-send transcript attachments plus the plain
// text stored with the ticket. format: 'txt' | 'html' | 'both'.
async function generateTranscripts(channel, format = 'both', meta = {}) {
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
  const html = renderTranscriptHtml({ channel, messages: collected, meta });
  const base = safeName(channel);
  const date = new Date().toISOString().slice(0, 10);

  const txt =
    format === 'html'
      ? null
      : new AttachmentBuilder(Buffer.from(text || 'No messages.', 'utf8'), { name: `${base}-${date}.txt` });
  const htmlFile =
    format === 'txt'
      ? null
      : new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${base}-${date}.html` });

  return { txt, html: htmlFile, text, htmlText: html, messages: collected.length, name: base };
}

module.exports = { generateTranscripts, renderTranscriptHtml, escapeHtml, messageLine, safeName };
