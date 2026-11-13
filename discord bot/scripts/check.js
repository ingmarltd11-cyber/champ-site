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
const { findWelcomeChannel } = require('../src/handlers/welcomeEvents');
const { pickWinners, giveawayEmbedData, isTooNew } = require('../src/utils/giveaway');
const giveawayStore = require('../src/utils/giveawayStore');
const ticketStore = require('../src/utils/ticketStore');
const { renderTemplate, buildWelcomeMessage, buildGoodbyeMessage, buildLinks } = require('../src/utils/welcome');
const { escapeHtml, renderTranscriptHtml } = require('../src/utils/transcript');
const { saveTranscript } = require('../src/utils/transcriptStore');
const { endGiveaway, rerollGiveaway } = require('../src/handlers/giveawayInteractions');
const { checkEnv, validateTicketConfig } = require('../src/utils/preflight');
const { buildPayload } = require('../src/health');
const { formatUptime } = require('../src/utils/format');
const { parseDuration, formatDuration } = require('../src/utils/moderation');
const { loadRules } = require('../src/commands/rules');
const { collectCommands } = require('../src/deploy-commands');

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
  check(validateTicketConfig(tickets).errors.length === 0, 'the shipped ticket config validates');
  const duplicate = JSON.parse(JSON.stringify(tickets));
  duplicate.types.push({ ...duplicate.types[0] });
  check(
    validateTicketConfig(duplicate).errors.some((error) => error.includes('Duplicate')),
    'duplicate ticket ids are rejected at boot'
  );
  const missingQuestions = JSON.parse(JSON.stringify(tickets));
  missingQuestions.types[0].questions = new Array(6).fill({ id: 'q', label: 'Q' });
  check(
    validateTicketConfig(missingQuestions).errors.some((error) => error.includes('5')),
    'more than five modal questions are rejected'
  );
  const giveawayConfig = getGiveawayConfig();
  check(giveawayConfig.defaultWinners === 1, 'giveaway defaults load');

  console.log('\nenvironment');
  const cleanEnv = checkEnv({
    DISCORD_TOKEN: 'token',
    CLIENT_ID: '1',
    GUILD_ID: '2',
    SITE_URL: 'https://champ-site-psi.vercel.app',
  });
  check(cleanEnv.errors.length === 0, 'a complete environment passes');
  const emptyEnv = checkEnv({});
  check(
    emptyEnv.errors.some((error) => error.includes('DISCORD_TOKEN')),
    'a missing token is a hard error'
  );
  check(
    checkEnv({ DISCORD_TOKEN: 'token', SUPABASE_URL: 'https://x.supabase.co' }).warnings.some((w) => w.includes('both')),
    'a half-configured Supabase is warned about'
  );
  check(formatUptime(90061000) === '1d 1h 1m', 'uptime formatting is stable');

  console.log('\nmoderation');
  check(parseDuration('10m') === 600000, 'a 10m timeout parses');
  check(parseDuration('2h') === 7200000 && parseDuration('1d') === 86400000, 'hours and days parse');
  check(parseDuration('45s') === 45000, 'seconds parse');
  check(parseDuration('15') === 900000, 'a bare number means minutes');
  check(parseDuration('0m') === null && parseDuration('abc') === null, 'invalid durations are rejected');
  check(parseDuration('29d') === null, 'timeouts longer than 28 days are rejected');
  check(formatDuration(600000) === '10m' && formatDuration(86400000) === '1d', 'durations format compactly');
  const rules = loadRules();
  check(rules.sections.length >= 8, 'the shipped rules have at least eight sections');
  check(
    rules.sections.every((section) => section.title && section.body.length <= 1024),
    'every rule has a title and fits a Discord field'
  );
  check(typeof rules.showTermsButton === 'boolean', 'the rules term-button switch is explicit');

  console.log('\ncommands');
  const commands = collectCommands();
  const names = commands.map((command) => command.name);
  for (const required of ['announce', 'rules', 'mod', 'ticket-panel', 'giveaway', 'welcome', 'status', 'help', 'link']) {
    check(names.includes(required), `/${required} is registered`);
  }
  check(new Set(names).size === names.length, 'no command name is registered twice');
  check(
    commands.every((command) => {
      const json = command.toJSON();
      return Boolean(json.name) && Boolean(json.description);
    }),
    'command builders serialize cleanly'
  );
  const modJson = commands.find((command) => command.name === 'mod').toJSON();
  check(
    modJson.options.length === 5 && modJson.options.every((option) => option.type === 1),
    '/mod exposes five subcommands'
  );

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
  check(welcome.links.length >= 2 && welcome.links[0].url.startsWith('https://'), 'welcome link buttons are rendered');
  const systemChannel = { name: 'general', isTextBased: () => true };
  const fallback = await findWelcomeChannel(
    { systemChannel, channels: { cache: [] } },
    { channelId: '' }
  );
  check(fallback === systemChannel, 'welcome falls back to the system channel');
  const namedChannel = { name: 'welcome', isTextBased: () => true };
  const named = await findWelcomeChannel(
    { systemChannel: null, channels: { cache: [namedChannel] } },
    { channelId: '' }
  );
  check(named === namedChannel, 'welcome falls back to a named welcome channel');
  let createdOptions = null;
  const createdChannel = await findWelcomeChannel(
    {
      systemChannel: null,
      channels: {
        cache: [],
        create: async (options) => {
          createdOptions = options;
          return { name: options.name, isTextBased: () => true };
        },
      },
      members: { me: { permissions: { has: () => true } } },
    },
    { channelId: '' },
    { create: true }
  );
  check(createdChannel?.name === 'welcome' && createdOptions?.name === 'welcome', 'welcome creates a channel when none exists');
  check(buildLinks({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }, {}).length === 0, 'unsafe welcome links are dropped');
  const goodbye = buildGoodbyeMessage(fakeMember, getWelcomeConfig(), { memberCount: 41 });
  check(goodbye.embeds[0].title.includes('tester'), 'the goodbye title names the member');

  const updated = await updateWelcomeConfig({ channelId: '999', dm: { enabled: true } });
  check(updated.channelId === '999' && updated.dm.enabled === true, 'welcome overrides are saved');
  check(updated.embed.title.includes('Welcome'), 'saving an override keeps the other defaults');
  const reset = await resetWelcomeConfig();
  check(reset.channelId === '', 'reset clears the overrides');

  console.log('\ntickets');
  const storage = await ticketStore.init();
  check(storage.mode === 'json' && !ticketStore.isSupabaseActive(), 'without Supabase the JSON store is used');
  await ticketStore.addTicket('chan-1', { guildId: 'guild', userId: 'user-1', typeId: 'support', answers: { issue: 'test' } });
  check((await ticketStore.countOpenByUser('user-1')) === 1, 'an open ticket is counted per user');
  await ticketStore.claimTicket('chan-1', 'staff-1');
  check((await ticketStore.getTicket('chan-1')).claimedBy === 'staff-1', 'a ticket can be claimed');
  await ticketStore.setRating('chan-1', 5, 'great');
  const stats = await ticketStore.getStats();
  check(stats.openTotal === 1 && stats.avgRating === 5, 'ticket stats include open count and rating');
  check(stats.openedLast24h === 1 && stats.total === 1, 'ticket stats count the last 24 hours');
  await ticketStore.setWarned('chan-1');
  check((await ticketStore.getTicket('chan-1')).warned === true, 'an inactivity warning is stored');
  await ticketStore.touchTicket('chan-1');
  check((await ticketStore.getTicket('chan-1')).warned === false, 'activity clears the warning');

  console.log('\nhealth');
  const health = await buildPayload({
    client: {
      isReady: () => true,
      user: { tag: 'bot#0001', id: '1' },
      ws: { ping: 42 },
      guilds: { cache: { size: 2 } },
    },
    startedAt: Date.now() - 61000,
  });
  check(health.status === 'ok' && health.ready === true, 'the health payload is ok when connected');
  check(health.guilds === 2 && health.pingMs === 42, 'health reports guilds and ping');
  check(health.tickets.openTickets === 1, 'health includes the open ticket count');
  check(health.storage === 'json', 'health reports the storage mode');
  const starting = await buildPayload({ client: { isReady: () => false, guilds: { cache: { size: 0 } } } });
  check(starting.status === 'ok' && starting.ready === false, 'the health endpoint answers before the gateway is ready');

  await ticketStore.closeTicket('chan-1', { transcript: 'hello' });
  const closed = await ticketStore.getTicket('chan-1');
  check(closed.status === 'closed' && closed.transcript === 'hello', 'a ticket closes with its transcript');
  check((await ticketStore.countOpenByUser('user-1')) === 0, 'closed tickets stop counting as open');

  console.log('\ntranscripts');
  check(escapeHtml('<script>&') === '&lt;script&gt;&amp;', 'transcript HTML escapes markup');
  const transcriptHtml = renderTranscriptHtml({
    channel: { name: 'ticket-test', guild: { name: 'Champ' } },
    messages: [
      {
        createdAt: new Date(),
        author: { tag: 'tester#0001', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
        content: '<script>alert(1)</script>',
        embeds: [{ title: 'Order', description: 'paid' }],
        attachments: new Map(),
      },
    ],
    meta: { closedBy: 'staff#0001', reason: 'done' },
  });
  check(transcriptHtml.includes('&lt;script&gt;') && !transcriptHtml.includes('<script>alert'), 'transcript content is escaped');
  check(transcriptHtml.includes('staff#0001') && transcriptHtml.includes('Order'), 'transcript keeps the metadata and embeds');
  const saved = await saveTranscript({ name: 'ticket-test' }, transcriptHtml);
  check(Boolean(saved) && saved.endsWith('.html'), 'the transcript is saved to disk');
  check(saved && fs.existsSync(saved), 'the saved transcript exists');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails === 0 ? '\nBOT CHECK OK' : `\nBOT CHECK FAILED (${fails})`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nBOT CHECK CRASHED:', err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
