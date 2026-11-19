const panelStore = require('./panelStore');
const { renderPanel } = require('../panels');
const { log } = require('../utils/logger');

// One place that knows how to put a panel on screen. Every panel type renders from its stored
// record, so editing config or restarting the bot never posts a second copy of the same panel.
async function postPanel(client, panel, { force = false } = {}) {
  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`The panel channel ${panel.channelId} is missing or not text.`);

  const payload = await renderPanel(panel, { client, guild: channel.guild });
  let message = null;
  if (!force && panel.messageId) {
    message = await channel.messages.fetch(panel.messageId).catch(() => null);
  }
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }
  await panelStore.attachMessage(panel.id, { channelId: channel.id, messageId: message.id });
  return message;
}

async function refreshPanel(client, panel) {
  try {
    return await postPanel(client, panel);
  } catch (err) {
    log.warn('panels', `could not refresh panel ${panel.id} (${panel.type}): ${err.message}`);
    return null;
  }
}

async function refreshAllPanels(client, { guildId = null } = {}) {
  const panels = await panelStore.listPanels({ guildId });
  let refreshed = 0;
  for (const panel of panels) {
    if (await refreshPanel(client, panel)) refreshed += 1;
  }
  return { total: panels.length, refreshed };
}

async function deletePanelMessage(client, panel) {
  if (!panel?.channelId || !panel?.messageId) return false;
  try {
    const channel = await client.channels.fetch(panel.channelId);
    const message = await channel.messages.fetch(panel.messageId);
    await message.delete();
    return true;
  } catch {
    return false;
  }
}

module.exports = { postPanel, refreshPanel, refreshAllPanels, deletePanelMessage };
