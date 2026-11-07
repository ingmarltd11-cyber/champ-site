const fs = require('fs');
const path = require('path');

// Everything the bot reads at start-up lives in ./config. The ticket panel text and the
// welcome messages are JSON so they can be edited without touching code or rebuilding.
const ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const cache = new Map();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[config] could not read ${file}:`, err.message);
    return fallback;
  }
}

function load(name, fallback) {
  if (!cache.has(name)) cache.set(name, readJson(path.join(CONFIG_DIR, name), fallback));
  return cache.get(name);
}

const TICKET_DEFAULTS = {
  panel: {
    title: '🎫 Champ Support',
    description: 'Choose a reason for your ticket below.',
    placeholder: 'Choose a support category...',
    color: '#FFC93C',
    footer: 'Champ Client Support',
  },
  settings: {
    ticketCategoryId: '',
    maxOpenTicketsPerUser: 1,
    defaultSupportRoleName: 'Support',
    naming: '{emoji}-{username}',
    logChannelId: '',
    transcriptChannelId: '',
    staffRoleIds: [],
    deleteDelaySeconds: 5,
    sendTranscriptDm: true,
    transcriptFormat: 'both',
    rating: { enabled: true, title: '⭐ Rate your support', message: 'How satisfied were you?' },
    autoClose: { enabled: true, inactiveHours: 48, warningHours: 24 },
  },
  types: [],
};

const GIVEAWAY_DEFAULTS = {
  defaultDurationMinutes: 60,
  defaultWinners: 1,
  defaultColor: '#FFC93C',
  emoji: '🎉',
  managerRoleIds: [],
  dmWinners: true,
  logChannelId: '',
  requirements: { defaultRoleId: '', minAccountAgeDays: 0 },
};

const WELCOME_DEFAULTS = {
  enabled: true,
  channelId: '',
  goodbyeChannelId: '',
  rulesChannelId: '',
  siteUrl: 'https://champ-site-psi.vercel.app',
  mention: true,
  mentionText: '{mention}',
  autoRoles: [],
  embed: {
    title: 'Welcome to Champ, {username}!',
    description:
      'You are member **#{memberCount}** of **{server}**.\n\n' +
      'Read {rules}, download the client at {site} and grab a role in the channels below.',
    color: '#FFC93C',
    footer: 'Champ Client',
    thumbnail: true,
    image: '',
  },
  dm: {
    enabled: false,
    message:
      'Welcome to **{server}**, {username}! Your download and dashboard are at {site}.',
  },
  links: [
    { label: 'Download Champ', url: '{site}' },
    { label: 'Join the Discord', url: 'https://discord.gg/6vyQnVjeX' },
  ],
  goodbye: {
    enabled: true,
    title: 'Goodbye, {username}',
    description: '{user} left **{server}**. We are now {memberCount} members.',
    color: '#FF4D5E',
  },
};

function withDefaults(value, defaults) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = Array.isArray(defaults) ? [] : { ...defaults };
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      entry && typeof entry === 'object' && !Array.isArray(entry) && defaults && typeof defaults[key] === 'object'
        ? withDefaults(entry, defaults[key])
        : entry;
  }
  return out;
}

function getTicketConfig() {
  return withDefaults(load('tickets.json', {}), TICKET_DEFAULTS);
}

function getGiveawayConfig() {
  return withDefaults(load('giveaway.json', {}), GIVEAWAY_DEFAULTS);
}

function getWelcomeDefaults() {
  return withDefaults(load('welcome.json', {}), WELCOME_DEFAULTS);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  ROOT,
  CONFIG_DIR,
  readJson,
  getTicketConfig,
  getGiveawayConfig,
  getWelcomeDefaults,
  WELCOME_DEFAULTS,
  clearCache,
};
