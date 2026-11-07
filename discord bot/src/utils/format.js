// Small formatting helpers shared by the status command, the health endpoint and the checks.
function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return parts.join(' ') || '0s';
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

function siteUrl(env = process.env) {
  const base = String(env.SITE_URL || 'https://champ-site-psi.vercel.app').trim();
  return base.replace(/\/+$/, '');
}

function inviteUrl(env = process.env) {
  return String(env.DISCORD_INVITE || 'https://discord.gg/6vyQnVjeX').trim();
}

// Discord only accepts http(s) link buttons. Anything else is dropped before rendering.
function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

module.exports = { formatUptime, plural, siteUrl, inviteUrl, isHttpUrl, truncate };
