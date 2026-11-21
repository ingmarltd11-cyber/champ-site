'use strict';

const panelStore = require('./panelStore');
const { postPanel } = require('./panelRuntime');
const { log } = require('../utils/logger');

// Two panels are part of the server layout: creator business in #media and everything else in
// #tickets. They are stored like any other panel, so restarts edit the same message instead of
// posting duplicates, and staff can still manage them from the control panel.
const DEFAULTS = [
  {
    channelName: 'media',
    name: 'media',
    options: {
      title: '🎬 Champ Media',
      description:
        'Apply for the Media role or request a payout for your Champ content.\n\nPick a category below and the team will reply in your private ticket.',
      placeholder: 'Choose media category...',
      typeIds: ['media-payout', 'media-apply'],
    },
  },
  {
    channelName: 'tickets',
    name: 'tickets',
    options: {
      title: '🎫 Champ Support',
      description:
        'Choose what you need help with and the team will reply in your private ticket.\n\n**AI Support** answers instantly; the AI calls a human whenever it cannot help.',
      placeholder: 'Choose a support category...',
      typeIds: [
        'refund',
        'buy-client',
        'buy-ad',
        'giveaway-claim',
        'support',
        'license',
        'crashing',
        'ai-support',
      ],
    },
  },
];

function findChannel(guild, name) {
  return (
    guild.channels.cache.find(
      (channel) => channel.isTextBased?.() && !channel.isThread?.() && String(channel.name).toLowerCase() === name
    ) || null
  );
}

async function ensureDefaultPanels(client) {
  const result = { created: 0, updated: 0, skipped: [] };
  for (const guild of client.guilds.cache.values()) {
    const panels = await panelStore.listPanels({ guildId: guild.id, type: 'tickets' }).catch(() => []);
    for (const def of DEFAULTS) {
      const channel = findChannel(guild, def.channelName);
      if (!channel) {
        result.skipped.push(`${guild.name}:#${def.channelName}`);
        continue;
      }

      const existing =
        panels.find((panel) => panel.channelId === channel.id) ||
        panels.find((panel) => String(panel.name).toLowerCase() === def.name);

      try {
        if (existing) {
          // Keep staff copy edits, but always enforce the category list the panel is for.
          const options = { ...def.options, ...existing.options, typeIds: def.options.typeIds };
          const updated = await panelStore.updatePanel(existing.id, { options });
          await postPanel(client, updated);
          result.updated += 1;
        } else {
          const panel = await panelStore.createPanel({
            guildId: guild.id,
            type: 'tickets',
            name: def.name,
            channelId: channel.id,
            options: def.options,
            createdBy: client.user?.id || null,
          });
          await postPanel(client, panel);
          result.created += 1;
          panels.push(panel);
        }
      } catch (err) {
        log.warn('panels', `default ${def.name} panel in ${guild.name} failed: ${err.message}`);
        result.skipped.push(`${guild.name}:#${def.channelName}`);
      }
    }
  }
  return result;
}

module.exports = { DEFAULTS, findChannel, ensureDefaultPanels };
