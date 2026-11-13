const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { siteUrl, inviteUrl } = require('../utils/format');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Everything the Champ bot can do, with the useful links');

function linkRow() {
  const site = siteUrl();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Website').setURL(site).setStyle(ButtonStyle.Link),
    new ButtonBuilder().setLabel('Dashboard').setURL(`${site}/dashboard.html`).setStyle(ButtonStyle.Link),
    new ButtonBuilder().setLabel('Discord').setURL(inviteUrl()).setStyle(ButtonStyle.Link)
  );
}

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Champ bot · help')
    .setDescription(
      'Tickets, giveaways and the welcome system. Slash commands are available to everyone unless a ' +
        'row says **staff**.'
    )
    .setColor('#2EC4B6')
    .addFields(
      {
        name: '🔗 Account',
        value: [
          '`/link code:<code>` — connect Discord to your Champ dashboard account',
          `Link code: ${siteUrl()}/dashboard.html`,
        ].join('\n'),
      },
      {
        name: '🎫 Tickets',
        value: [
          '`/ticket-panel` **staff** — post the support dropdown',
          '`/ticket-close [reason]` — close your own ticket',
          '`/ticket-add user:@member` **staff** — let someone else join',
          '`/ticket-remove user:@member` **staff** — remove them again',
          '`/ticket-transcript` **staff** — export the conversation',
          '`/ticket-stats` **staff** — open/closed counts and ratings',
        ].join('\n'),
      },
      {
        name: '🎉 Giveaways',
        value: [
          '`/giveaway create` **staff** — prize, minutes, winners, optional role and account age',
          '`/giveaway end [id]` **staff** — draw the winners now',
          '`/giveaway reroll id [winners]` **staff** — draw again',
          '`/giveaway list` · `/giveaway entries id` · `/giveaway delete id`',
        ].join('\n'),
      },
      {
        name: '👋 Welcome',
        value: [
          '`/welcome status` · `preview` · `test` **staff**',
          '`/welcome channel` · `autorole` · `dm` · `message` · `title` · `reset` **staff**',
        ].join('\n'),
      },
      {
        name: '🛡️ Staff tools',
        value: [
          '`/announce` — branded announcement with optional @here/@everyone and a link button',
          '`/rules` — post the server rules from `config/rules.json`',
          '`/mod timeout user duration reason` — mute for `10m`, `2h`, `1d`',
          '`/mod kick` · `/mod ban [delete_days]` — with a DM, a reason and a mod-log entry',
          '`/mod purge count` — clear up to 100 recent messages',
          '`/mod slowmode seconds` — 0 turns it off',
        ].join('\n'),
      },
      {
        name: 'ℹ️ Bot',
        value: '`/status` — uptime, latency, tickets and giveaways\n`/help` — this page',
      }
    )
    .setFooter({ text: 'Champ Client · support and community' });

  return interaction.reply({ embeds: [embed], components: [linkRow()], ephemeral: true });
}

module.exports = { data, execute };
