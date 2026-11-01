const giveawayStore = require('../utils/giveawayStore');
const { endGiveaway } = require('../handlers/giveawayInteractions');

// Polls the persisted giveaways every 20 seconds. A restart therefore resumes every timer:
// nothing depends on keeping a setTimeout alive for days.
function startGiveawayScheduler(client, { intervalMs = 20000 } = {}) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const due = await giveawayStore.listDue();
      for (const giveaway of due) {
        try {
          const result = await endGiveaway(client, giveaway);
          if (!result.alreadyEnded) {
            console.log(`[giveaway] ended ${giveaway.id} (${giveaway.prize}) with ${result.winners.length} winner(s)`);
          }
        } catch (err) {
          console.error(`[giveaway] could not end ${giveaway.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[giveaway] scheduler failed:', err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}

module.exports = { startGiveawayScheduler };
