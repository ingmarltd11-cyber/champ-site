const { getTicketConfig } = require('../config/loadConfig');
const ticketStore = require('../utils/ticketStore');
const { closeTicketChannel } = require('../handlers/ticketInteractions');

// Sluit inactieve tickets automatisch:
// - eerst een waarschuwing in het kanaal (warningHours vóór sluiten),
// - daarna sluiten met transcript + DM (reden: autoClose.reason).
function startAutoClose(client) {
  setInterval(async () => {
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
          await closeTicketChannel(channel, config, { closerTag: 'auto-close', reason: auto.reason || null });
        } else if (!ticket.warned && idle >= inactiveMs - warnMs) {
          await channel.send(auto.warningMessage || '⚠️ This ticket is inactive and will be closed automatically soon.').catch(() => {});
          await ticketStore.setWarned(ticket.channelId);
        }
      }
    } catch (err) {
      console.error('Auto-close job failed:', err.message);
    }
  }, 15 * 60 * 1000);
}

module.exports = { startAutoClose };
