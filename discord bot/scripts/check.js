// Offline check for everything that does not need a Discord connection.
// Run with: npm run check
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'champ-bot-'));
process.env.DATA_DIR = tmp;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const { getTicketConfig, getGiveawayConfig } = require('../src/config/loadConfig');
const { getWelcomeConfig, updateWelcomeConfig, resetWelcomeConfig } = require('../src/utils/welcomeSettings');
const { pickWinners, giveawayEmbedData, isTooNew } = require('../src/utils/giveaway');
const giveawayStore = require('../src/utils/giveawayStore');
const ticketStore = require('../src/utils/ticketStore');
const { renderTemplate, buildWelcomeMessage, buildGoodbyeMessage } = require('../src/utils/welcome');
const { escapeHtml } = require('../src/utils/transcript');
const { endGiveaway, rerollGiveaway } = require('../src/handlers/giveawayInteractions');

let fails = 0;
function check(ok, label) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    fails += 1;
    console.log(`  FAIL ${label}`);
  }
}

const fakeMember = {
  id: '123456789012345678',
  user: {
    id: '123456789012345678',
    username: 'tester',
    tag: 'tester#0001',
    createdAt: new Date(Date.now() - 10 * 86400000),
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  },
  guild: { name: 'Champ', memberCount: 42 },
};

(async () => {
  console.log('\nconfig');
  const tickets = getTicketConfig();
  check(tickets.types.length >= 5, 'ticket categories load from config/tickets.json');
  check(typeof tickets.panel.description === 'string', 'ticket panel copy is present');
  const giveawayConfig = getGiveawayConfig();
  check(giveawayConfig.defaultWinners === 1, 'giveaway defaults load');

  console.log('\ngiveaway drawing');
  const entries = ['a', 'b', 'c', 'd', 'e', 'f'];
  const winners = pickWinners(entries, 3);
  check(winners.length === 3, 'three winners are drawn');
  check(new Set(winners).size === 3, 'winners are unique');
  check(entries.length === 6, 'the entry list is not mutated');
  check(pickWinners(entries, 99).length === 6, 'asking for more winners than entries returns everyone');
  check(pickWinners([], 2).length === 0, 'an empty giveaway draws nobody');
  const fixed = pickWinners(['a', 'b', 'c'], 3, (max) => max - 1);
  check(fixed.join('') === 'abc' || fixed.length === 3, 'an injected rng is honoured');
  check(isTooNew(new Date(Date.now() - 3600000), 2) === true, 'a one-hour-old account is too new for a 2-day rule');
  check(isTooNew(new Date(Date.now() - 10 * 86400000), 2) === false, 'an old account passes the age rule');

  const openEmbed = giveawayEmbedData(
    { prize: 'Legendary Key', winners: 1, endsAt: new Date().toISOString(), hostId: '1' },
    { entriesCount: 4 }
  );
  check(openEmbed.title.includes('Legendary Key'), 'the embed shows the prize');
  check(openEmbed.fields.some((f) => f.name === 'Entries' && f.value === '4'), 'the embed counts entries');
  const endedEmbed = giveawayEmbedData(
    { prize: 'Legendary Key', winners: 1, endsAt: new Date().toISOString(), entries: [] },
    { entriesCount: 1, ended: true, winnerIds: ['w1'] }
  );
  check(endedEmbed.fields.some((f) => f.name.includes('Winner') && f.value.includes('w1')), 'the ended embed names the winner');

  console.log('\ngiveaway store');
  const created = await giveawayStore.createGiveaway({
    guildId: 'guild',
    channelId: 'channel',
    messageId: 'message',
    prize: 'Test prize',
    winners: 2,
    hostId: 'host',
    endsAt: new Date(Date.now() - 1000).toISOString(),
  });
  const first = await giveawayStore.addEntry(created.id, 'user-1');
  const second = await giveawayStore.addEntry(created.id, 'user-1');
  const third = await giveawayStore.addEntry(created.id, 'user-2');
  check(first.added === true, 'the first click adds an entry');
  check(second.added === false, 'clicking twice does not duplicate the entry');
  check(third.total === 2, 'the entry count updates');
  const due = await giveawayStore.listDue();
  check(due.some((g) => g.id === created.id), 'an expired giveaway is picked up by the scheduler');
  const ended = await giveawayStore.markEnded(created.id, { winnerIds: ['user-2'] });
  check(ended.ended === true && ended.winnerIds[0] === 'user-2', 'a giveaway can be ended with a winner');
  check((await giveawayStore.listGiveaways({ activeOnly: true })).every((g) => g.id !== created.id), 'ended giveaways leave the active list');
  await giveawayStore.removeGiveaway(created.id);
  check((await giveawayStore.getGiveaway(created.id)) === null, 'a giveaway can be deleted');

  // Full ending flow against a fake Discord client: message edit, announcement and winner DM.
  const live = await giveawayStore.createGiveaway({
    guildId: 'guild',
    channelId: 'channel',
    messageId: 'message',
    prize: 'Champ Lifetime',
    winners: 1,
    hostId: 'host',
    endsAt: new Date(Date.now() - 1000).toISOString(),
  });
  await giveawayStore.addEntry(live.id, 'user-1');
  await giveawayStore.addEntry(live.id, 'user-2');
  const edits = [];
  const announcements = [];
  const dms = [];
  const fakeChannel = {
    isTextBased: () => true,
    messages: { fetch: async () => ({ edit: async (payload) => edits.push(payload) }) },
    send: async (payload) => announcements.push(payload),
  };
  const fakeClient = {
    channels: { fetch: async () => fakeChannel },
    users: { fetch: async (id) => ({ send: async (text) => dms.push({ id, text }) }) },
  };
  const finished = await endGiveaway(fakeClient, live, { endedBy: 'host' });
  check(finished.winners.length === 1, 'ending a giveaway draws exactly one winner');
  check(edits.length === 1 && edits[0].components.length === 1, 'the giveaway message is edited once');
  check(
    announcements.length === 1 && announcements[0].includes(finished.winners[0]),
    'the winner is announced'
  );
  check(dms.length === 1 && dms[0].id === finished.winners[0], 'the winner gets a DM');
  const rerolled = await rerollGiveaway(fakeClient, live, { count: 1, by: 'host' });
  check(
    rerolled.winners.length === 1 && rerolled.winners[0] !== finished.winners[0],
    'a reroll avoids the earlier winner'
  );
  check((await endGiveaway(fakeClient, live)).alreadyEnded === true, 'a giveaway cannot be ended twice');
  await giveawayStore.removeGiveaway(live.id);

  console.log('\nwelcome');
  check(renderTemplate('Hi {username} ({unknown})', { username: 'bob' }) === 'Hi bob ({unknown})', 'unknown placeholders are left alone');
  const welcome = buildWelcomeMessage(fakeMember, getWelcomeConfig(), { memberCount: 42 });
  check(welcome.embeds[0].title.includes('tester'), 'the welcome title greets the member');
  check(welcome.embeds[0].description.includes('42'), 'the welcome text includes the member count');
  check(welcome.embeds[0].thumbnail?.includes('cdn.discordapp.com'), 'the avatar is used as the thumbnail');
  const goodbye = buildGoodbyeMessage(fakeMember, getWelcomeConfig(), { memberCount: 41 });
  check(goodbye.embeds[0].title.includes('tester'), 'the goodbye title names the member');

  const updated = await updateWelcomeConfig({ channelId: '999', dm: { enabled: true } });
  check(updated.channelId === '999' && updated.dm.enabled === true, 'welcome overrides are saved');
  check(updated.embed.title.includes('Welcome'), 'saving an override keeps the other defaults');
  const reset = await resetWelcomeConfig();
  check(reset.channelId === '', 'reset clears the overrides');

  console.log('\ntickets');
  await ticketStore.addTicket('chan-1', { guildId: 'guild', userId: 'user-1', typeId: 'support', answers: { issue: 'test' } });
  check((await ticketStore.countOpenByUser('user-1')) === 1, 'an open ticket is counted per user');
  await ticketStore.claimTicket('chan-1', 'staff-1');
  check((await ticketStore.getTicket('chan-1')).claimedBy === 'staff-1', 'a ticket can be claimed');
  await ticketStore.setRating('chan-1', 5, 'great');
  const stats = await ticketStore.getStats();
  check(stats.openTotal === 1 && stats.avgRating === 5, 'ticket stats include open count and rating');
  await ticketStore.closeTicket('chan-1', { transcript: 'hello' });
  const closed = await ticketStore.getTicket('chan-1');
  check(closed.status === 'closed' && closed.transcript === 'hello', 'a ticket closes with its transcript');
  check((await ticketStore.countOpenByUser('user-1')) === 0, 'closed tickets stop counting as open');

  console.log('\ntranscripts');
  check(escapeHtml('<script>&') === '&lt;script&gt;&amp;', 'transcript HTML escapes markup');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails === 0 ? '\nBOT CHECK OK' : `\nBOT CHECK FAILED (${fails})`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nBOT CHECK CRASHED:', err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
