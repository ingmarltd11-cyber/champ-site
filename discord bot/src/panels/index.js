const tickets = require('./tickets');
const giveaways = require('./giveaways');
const knowledge = require('./knowledge');
const payments = require('./payments');
const misc = require('./misc');

// One registry for every panel type. Adding a feature panel means adding an entry here and a
// renderer next to it; the control panel and the persistent panel refresher pick it up.
const PANEL_TYPES = {
  tickets: {
    label: 'Ticket panel',
    emoji: '🎫',
    description: 'Category dropdown that opens private ticket channels',
    build: tickets.build,
  },
  giveaways: {
    label: 'Giveaway panel',
    emoji: '🎉',
    description: 'Create and list giveaways with entry buttons',
    build: giveaways.build,
  },
  knowledge: {
    label: 'Knowledge panel',
    emoji: '📚',
    description: 'Browse and search forum guides, or ask a question',
    build: knowledge.build,
  },
  payments: {
    label: 'Payment panel',
    emoji: '💳',
    description: 'Buy weekly, monthly or lifetime access inside Discord',
    build: payments.build,
  },
  rules: {
    label: 'Rules panel',
    emoji: '📜',
    description: 'Post the server rules with a terms button',
    build: misc.rules,
  },
  welcome: {
    label: 'Welcome panel',
    emoji: '👋',
    description: 'Preview and test the welcome flow',
    build: misc.welcome,
  },
  status: {
    label: 'Status panel',
    emoji: '🛰️',
    description: 'Live uptime, ticket and giveaway counts',
    build: misc.status,
  },
  help: {
    label: 'Help panel',
    emoji: '❓',
    description: 'Explain what the bot can do with useful links',
    build: misc.help,
  },
};

function panelMeta(type) {
  return PANEL_TYPES[type] || null;
}

async function renderPanel(panel, context = {}) {
  const entry = PANEL_TYPES[panel.type];
  if (!entry) throw new Error(`Unknown panel type: ${panel.type}`);
  const payload = await entry.build(panel, context);
  return {
    embeds: payload.embeds || [],
    components: payload.components || [],
    allowedMentions: payload.allowedMentions || { parse: [] },
  };
}

module.exports = { PANEL_TYPES, panelMeta, renderPanel };
