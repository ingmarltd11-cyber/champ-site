const crypto = require('crypto');

// Pure giveaway helpers: no Discord objects in here, so the rules can be smoke-tested.
function defaultRandom(max) {
  return crypto.randomInt(max);
}

// Fisher-Yates with an injectable rng. Returns a fresh array; the entry list is never mutated.
function pickWinners(entries, count, random = defaultRandom) {
  const pool = [...new Set(entries)];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(Number(count) || 0, pool.length)));
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function requirementLines(giveaway, { roleName = null } = {}) {
  const lines = [];
  if (giveaway.requiredRoleId) lines.push(`Role: ${roleName || `<@&${giveaway.requiredRoleId}>`}`);
  if (Number(giveaway.minAccountAgeDays) > 0) {
    lines.push(`Account: at least ${giveaway.minAccountAgeDays} day(s) old`);
  }
  return lines;
}

// Plain object the handler turns into an EmbedBuilder. `ended` switches the copy from
// "click to enter" to the winners and can carry the reroll hint.
function giveawayEmbedData(giveaway, { entriesCount = 0, ended = false, winnerIds = [], endedBy = null } = {}) {
  const fields = [
    { name: 'Winners', value: String(giveaway.winners), inline: true },
    {
      name: ended ? 'Ended' : 'Ends',
      value: `<t:${Math.floor(new Date(giveaway.endsAt).getTime() / 1000)}:${ended ? 'f' : 'R'}>`,
      inline: true,
    },
    { name: 'Entries', value: String(entriesCount), inline: true },
  ];

  if (giveaway.hostId) fields.push({ name: 'Hosted by', value: `<@${giveaway.hostId}>`, inline: true });
  const requirements = requirementLines(giveaway);
  if (requirements.length) fields.push({ name: 'Requirements', value: requirements.join('\n') });

  if (ended) {
    fields.unshift({
      name: '🏆 Winner(s)',
      value: winnerIds.length ? winnerIds.map((id) => `<@${id}>`).join(', ') : 'No valid entries.',
    });
    if (endedBy) fields.push({ name: 'Ended by', value: `<@${endedBy}>`, inline: true });
  }

  return {
    title: `🎉 ${giveaway.prize}`,
    description: ended
      ? giveaway.description || 'This giveaway has ended. Thanks to everyone who entered!'
      : giveaway.description || 'Click the button below to enter. Good luck!',
    color: giveaway.color || '#FFC93C',
    fields,
    footer: ended ? 'Giveaway ended' : 'Click Enter to join',
    timestamp: true,
  };
}

function isTooNew(accountCreatedAt, minAccountAgeDays, now = Date.now()) {
  const days = Number(minAccountAgeDays) || 0;
  if (days <= 0) return false;
  const created = new Date(accountCreatedAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created < days * 86400000;
}

module.exports = {
  pickWinners,
  formatDuration,
  requirementLines,
  giveawayEmbedData,
  isTooNew,
  defaultRandom,
};
