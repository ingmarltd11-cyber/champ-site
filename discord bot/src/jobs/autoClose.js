const { getTicketConfig } = require('../config/loadConfig');
const ticketStore = require('../utils/ticketStore');
const { closeTicketChannel } = require('../handlers/ticketInteractions');
const { log } = require('../utils/logger');

// Closes inactive tickets:
// - a warning in the channel `warningHours` before the deadline,
// - then a close with transcript + DM (reason: autoClose.reason).
// Any member message clears the warning (ticketStore.touchTicket), so an active ticket is never
// closed because of an old warning.
function startAutoClose(client, { intervalMs = 15 * 60 * 1000 } = {}) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const config = getTicketConfig();
      const auto = config.settings.autoClose;
      if (!auto?.enabled) return;

      const inactiveMs = (auto.inactiveHours ?? 48) * 3600 * 1000;
      const warnMs = (auto.warningHours ?? 24) * 3600 * 1000;
      const now = Date.now();

      for (const ticket of await ticketStore.listOpenTickets()) {
        const last = new Date(ticket.lastActivityAt).getTime() || now;
        const idle = now - last;
        let channel = null;
        try {
          channel = await client.channels.fetch(ticket.channelId);
        } catch {
          continue;
        }
        if (!channel || !channel.isTextBased()) continue;

        if (idle >= inactiveMs) {
          await channel.send('🔒 This ticket is being closed automatically due to inactivity.').catch(() => {});
          const result = await closeTicketChannel(channel, config, {
            closerTag: 'auto-close',
            reason: auto.reason || 'Closed automatically due to inactivity.',
          });
          if (result) log.info('auto-close', `closed #${channel.name} after ${Math.round(idle / 3600000)}h of inactivity`);
        } else if (!ticket.warned && idle >= inactiveMs - warnMs) {
          await channel.send(auto.warningMessage || '⚠️ This ticket is inactive and will be closed automatically soon.').catch(() => {});
          await ticketStore.setWarned(ticket.channelId);
        }
      }
    } catch (err) {
      log.error('auto-close', err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}

module.exports = { startAutoClose };
