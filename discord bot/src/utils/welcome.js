// Welcome/goodbye message building, kept free of Discord objects so it can be tested.
// Supported placeholders: {user} {mention} {username} {tag} {server} {memberCount}
// {accountAgeDays} {createdAt} {site} {rules}
const PLACEHOLDERS = [
  '{user}',
  '{mention}',
  '{username}',
  '{tag}',
  '{server}',
  '{memberCount}',
  '{accountAgeDays}',
  '{createdAt}',
  '{site}',
  '{rules}',
];

function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

function memberVars(member, config = {}, { memberCount = null } = {}) {
  const user = member?.user || member || {};
  const createdAt = user.createdAt ? new Date(user.createdAt) : new Date();
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
  const guildName = member?.guild?.name || config.serverName || 'Champ';
  const rulesChannelId = config.rulesChannelId;
  return {
    user: user.id ? `<@${user.id}>` : user.username || 'there',
    mention: user.id ? `<@${user.id}>` : '',
    username: user.username || 'new member',
    tag: user.tag || user.username || 'new member',
    server: guildName,
    memberCount: memberCount ?? member?.guild?.memberCount ?? '—',
    accountAgeDays,
    createdAt: createdAt.toISOString().slice(0, 10),
    site: config.siteUrl || 'https://champ-site-psi.vercel.app',
    rules: rulesChannelId ? `<#${rulesChannelId}>` : 'the rules channel',
  };
}

function colour(value, fallback = '#FFC93C') {
  const candidate = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

// Returns { content, embeds: [plain object], dm }. The handler converts embeds through
// EmbedBuilder and sends it.
function buildWelcomeMessage(member, config = {}, options = {}) {
  const vars = memberVars(member, config, options);
  const embed = config.embed || {};
  const image = renderTemplate(embed.image || '', vars).trim();
  const description = renderTemplate(
    embed.description ||
      'Welcome to **{server}**, {user}! You are member **#{memberCount}**.\n\n' +
        'Read {rules} and grab your download at {site}.',
    vars
  );

  return {
    content:
      config.mention === false
        ? null
        : renderTemplate(config.mentionText || '{mention}', vars) || null,
    embeds: [
      {
        title: renderTemplate(embed.title || 'Welcome, {username}!', vars),
        description,
        color: colour(embed.color),
        thumbnail: embed.thumbnail === false ? null : vars.user ? member?.user?.displayAvatarURL?.({ size: 256 }) || null : null,
        image: image || null,
        footer: embed.footer ? renderTemplate(embed.footer, vars) : null,
      },
    ],
    dm:
      config.dm?.enabled && config.dm?.message
        ? renderTemplate(config.dm.message, vars)
        : null,
  };
}

function buildGoodbyeMessage(member, config = {}, options = {}) {
  const vars = memberVars(member, config, options);
  const goodbye = config.goodbye || {};
  return {
    content: null,
    embeds: [
      {
        title: renderTemplate(goodbye.title || 'Goodbye, {username}', vars),
        description: renderTemplate(
          goodbye.description || '{user} left **{server}**. We are now {memberCount} members.',
          vars
        ),
        color: colour(goodbye.color, '#FF4D5E'),
        thumbnail: null,
        image: null,
        footer: null,
      },
    ],
  };
}

module.exports = {
  PLACEHOLDERS,
  renderTemplate,
  memberVars,
  buildWelcomeMessage,
  buildGoodbyeMessage,
};
