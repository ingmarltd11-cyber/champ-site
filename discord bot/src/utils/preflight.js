const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { resolveSupportRole } = require('./permissions');
const { isHttpUrl } = require('./format');

// Startup validation. The bot refuses to boot on a broken required setting, but a placeholder
// channel id (the normal state before setup) only produces a warning with the exact command to fix it.
function placeholderId(value) {
  return !value || String(value).trim() === '' || String(value).includes('_ID');
}

function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  if (!env.DISCORD_TOKEN) errors.push('DISCORD_TOKEN is missing. Copy .env.example to .env or set it on the host.');
  if (!env.CLIENT_ID) warnings.push('CLIENT_ID is missing, so `npm run deploy` cannot register slash commands.');
  if (!env.GUILD_ID) warnings.push('GUILD_ID is not set: commands will be registered globally (up to an hour to appear).');

  if (env.SITE_URL && !isHttpUrl(env.SITE_URL)) {
    warnings.push(`SITE_URL is not a valid http(s) URL (${env.SITE_URL}); the default site link is used instead.`);
  }
  if (env.PORT !== undefined && !/^\d+$/.test(String(env.PORT).trim())) {
    warnings.push(`PORT is not a number (${env.PORT}); the health endpoint will not start.`);
  }
  if (Boolean(env.SUPABASE_URL) !== Boolean(env.SUPABASE_SERVICE_KEY)) {
    warnings.push('Set both SUPABASE_URL and SUPABASE_SERVICE_KEY, or neither: ticket history will use data/tickets.json.');
  }
  if (env.SUPABASE_URL && !isHttpUrl(env.SUPABASE_URL)) {
    errors.push('SUPABASE_URL is not a valid http(s) URL.');
  }
  if (env.ERROR_LOG_CHANNEL_ID && placeholderId(env.ERROR_LOG_CHANNEL_ID)) {
    warnings.push('ERROR_LOG_CHANNEL_ID still looks like a placeholder; bot errors only go to stdout.');
  }

  return { errors, warnings };
}

function validateColour(value, label, errors, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^#[0-9a-f]{6}$/i.test(String(value))) {
    errors.push(`${label} must be a hex colour like #FFC93C (got ${value}).`);
    return fallback;
  }
  return value;
}

function validateTicketConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    return { errors: ['config/tickets.json is not an object.'], warnings };
  }
  if (!config.panel || typeof config.panel !== 'object') errors.push('config/tickets.json is missing "panel".');
  else {
    if (!config.panel.title) errors.push('panel.title is required.');
    if (!config.panel.description) warnings.push('panel.description is empty, so the panel will look bare.');
    validateColour(config.panel.color, 'panel.color', errors, '#FFC93C');
  }

  const settings = config.settings || {};
  validateColour(settings.rating?.color, 'settings.rating.color', errors, '#FFC93C');
  if (settings.deleteDelaySeconds !== undefined) {
    const delay = Number(settings.deleteDelaySeconds);
    if (!Number.isFinite(delay) || delay < 0 || delay > 120) {
      errors.push('settings.deleteDelaySeconds must be between 0 and 120.');
    }
  }
  if (settings.transcriptFormat && !['txt', 'html', 'both'].includes(settings.transcriptFormat)) {
    errors.push('settings.transcriptFormat must be txt, html or both.');
  }
  if (settings.maxOpenTicketsPerUser !== undefined) {
    const max = Number(settings.maxOpenTicketsPerUser);
    if (!Number.isInteger(max) || max < 1 || max > 10) {
      errors.push('settings.maxOpenTicketsPerUser must be a whole number between 1 and 10.');
    }
  }
  if (settings.naming && !String(settings.naming).includes('{username}')) {
    warnings.push('settings.naming has no {username}; every ticket channel will look alike.');
  }
  const auto = settings.autoClose;
  if (auto?.enabled) {
    const inactive = Number(auto.inactiveHours);
    const warning = Number(auto.warningHours);
    if (!Number.isFinite(inactive) || inactive < 1) errors.push('settings.autoClose.inactiveHours must be at least 1.');
    if (!Number.isFinite(warning) || warning < 0 || warning >= inactive) {
      errors.push('settings.autoClose.warningHours must be lower than inactiveHours.');
    }
  }

  const types = Array.isArray(config.types) ? config.types : [];
  if (types.length === 0) errors.push('config/tickets.json has no ticket types, so the panel cannot open a ticket.');
  if (types.length > 25) errors.push('Discord allows at most 25 ticket types in one dropdown.');

  const seen = new Set();
  for (const [index, type] of types.entries()) {
    const where = `types[${index}]`;
    if (!type?.id || !/^[a-z0-9_-]+$/i.test(type.id)) {
      errors.push(`${where}.id must be letters, numbers, - or _ (got ${type?.id}).`);
      continue;
    }
    if (seen.has(type.id)) errors.push(`Duplicate ticket type id "${type.id}".`);
    seen.add(type.id);
    if (!type.label) errors.push(`${where} (${type.id}) is missing a label.`);
    if (type.label && String(type.label).length > 100) errors.push(`${where}.label is longer than 100 characters.`);
    if (type.description && String(type.description).length > 100) {
      warnings.push(`${where}.description is longer than Discord's 100 character hint and is cut off.`);
    }
    validateColour(type.color, `${where}.color`, errors, '#FFC93C');

    const questions = Array.isArray(type.questions) ? type.questions : [];
    if (questions.length > 5) errors.push(`${where} has ${questions.length} questions; a Discord modal allows 5.`);
    const questionIds = new Set();
    for (const [qIndex, question] of questions.entries()) {
      const at = `${where}.questions[${qIndex}]`;
      if (!question?.id) errors.push(`${at} is missing an id.`);
      else if (questionIds.has(question.id)) errors.push(`${at} repeats id "${question.id}".`);
      else questionIds.add(question.id);
      if (!question?.label) errors.push(`${at} is missing a label.`);
      if (question?.label && String(question.label).length > 45) errors.push(`${at}.label is longer than 45 characters.`);
      if (question?.placeholder && String(question.placeholder).length > 100) {
        warnings.push(`${at}.placeholder is longer than 100 characters and is cut off.`);
      }
      if (question?.maxLength && (Number(question.maxLength) < 1 || Number(question.maxLength) > 4000)) {
        errors.push(`${at}.maxLength must be between 1 and 4000.`);
      }
    }
  }

  return { errors, warnings };
}

function validateGiveawayConfig(config) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object') return { errors: ['config/giveaway.json is not an object.'], warnings };

  const winners = Number(config.defaultWinners);
  if (!Number.isInteger(winners) || winners < 1 || winners > 20) {
    errors.push('defaultWinners must be a whole number between 1 and 20.');
  }
  validateColour(config.defaultColor, 'defaultColor', errors, '#FFC93C');
  if (config.managerRoleIds !== undefined && !Array.isArray(config.managerRoleIds)) {
    errors.push('managerRoleIds must be an array of role ids.');
  }
  if (config.logChannelId && placeholderId(config.logChannelId)) {
    warnings.push('giveaway logChannelId is still a placeholder and is ignored.');
  }
  return { errors, warnings };
}

function missingPermissions(member) {
  if (!member?.permissions?.has) return ['unknown (member not cached)'];
  const needed = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
    ['AttachFiles', PermissionFlagsBits.AttachFiles],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ];
  return needed.filter(([, bit]) => !member.permissions.has(bit)).map(([name]) => name);
}

// Runtime audit: runs once on ready and returns a list of human readable warnings for each guild.
function auditGuild(guild, { ticketConfig, welcomeConfig, giveawayConfig } = {}) {
  const warnings = [];
  if (!guild) return warnings;

  const me = guild.members?.me;
  const missing = missingPermissions(me);
  if (missing.length) warnings.push(`missing permissions: ${missing.join(', ')} (re-invite the bot or fix its role)`);

  const settings = ticketConfig?.settings || {};
  if (!placeholderId(settings.ticketCategoryId)) {
    const category = guild.channels?.cache?.get(settings.ticketCategoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      warnings.push(`ticket category ${settings.ticketCategoryId} does not exist; tickets open without a category`);
    }
  } else {
    warnings.push('ticketCategoryId is not set; tickets open at the top of the channel list');
  }
  if (!placeholderId(settings.logChannelId)) {
    const log = guild.channels?.cache?.get(settings.logChannelId);
    if (!log?.isTextBased()) warnings.push(`ticket log channel ${settings.logChannelId} is missing or not text`);
  }
  if (!placeholderId(settings.transcriptChannelId)) {
    const channel = guild.channels?.cache?.get(settings.transcriptChannelId);
    if (!channel?.isTextBased()) warnings.push(`transcript channel ${settings.transcriptChannelId} is missing or not text`);
  }
  const support = resolveSupportRole(guild, null, ticketConfig);
  if (!support) warnings.push(`support role "${settings.defaultSupportRoleName || 'Support'}" was not found`);

  const welcomeChannel = welcomeConfig?.channelId;
  if (welcomeConfig?.enabled && placeholderId(welcomeChannel)) {
    warnings.push('welcome channel is not configured (/welcome channel welcome:#…); joins post nothing');
  } else if (welcomeConfig?.enabled && !guild.channels?.cache?.get(welcomeChannel)?.isTextBased()) {
    warnings.push(`welcome channel ${welcomeChannel} is missing or not text`);
  }
  if (welcomeConfig?.autoRoles?.length && me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    warnings.push('auto roles are configured but Manage Roles is missing');
  }

  if (giveawayConfig?.managerRoleIds?.length) {
    const missingRoles = giveawayConfig.managerRoleIds.filter((id) => !guild.roles?.cache?.has(id));
    if (missingRoles.length) warnings.push(`giveaway manager roles not found: ${missingRoles.join(', ')}`);
  }
  return warnings;
}

module.exports = {
  placeholderId,
  checkEnv,
  validateTicketConfig,
  validateGiveawayConfig,
  auditGuild,
  missingPermissions,
};
