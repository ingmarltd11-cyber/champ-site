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
      'Everything works from the **control panel**: buttons, menus and modals for tickets, panels, giveaways, ' +
        'welcome, rules, announcements, moderation, knowledge and payments. Slash commands are shortcuts.'
    )
    .setColor('#2EC4B6')
    .addFields(
      {
        name: '🎛️ Control panel',
        value: [
          '`/panel` **staff** — post the control panel once, then use its menus',
          'Every section has its own buttons; staff actions check your role when you press them.',
        ].join('\n'),
      },
      {
        name: '🎫 Tickets',
        value: [
          'Open a ticket from any ticket panel dropdown.',
          'Claim, transcript and close buttons live inside the ticket.',
          '`/ticket-panel name:<name>` **staff** — post another named ticket panel',
          '`/ticket-stats` · `/ticket-add` · `/ticket-remove` · `/ticket-transcript`',
        ].join('\n'),
      },
      {
        name: '📚 Knowledge',
        value: [
          'Browse or search the knowledge panel — entries are Discord forum threads.',
          'Ask a question from the panel; staff answer in the forum and it becomes searchable.',
          'There is deliberately no `/knowledge add`: the forum is the editor.',
        ].join('\n'),
      },
      {
        name: '💳 Payments',
        value: [
          '`/payments` — buy weekly, monthly or lifetime inside Discord',
          'Crypto, DonutSMP money and gift cards; the license lands on your linked account.',
          '`/payments panel:#channel` **staff** — post a persistent checkout panel',
          '`/link code:<code>` — connect Discord to your Champ dashboard account',
        ].join('\n'),
      },
      {
        name: '🎉 Community & staff',
        value: [
          '`/giveaway create` **staff** — prize, minutes, winners, role and account-age requirements',
          '`/welcome` · `/announce` · `/rules` · `/mod` **staff** — also available as control-panel screens',
          '`/status` — uptime, latency, tickets, giveaways and knowledge',
        ].join('\n'),
      }
    )
    .setFooter({ text: 'Champ Client · support and community' });

  return interaction.reply({ embeds: [embed], components: [linkRow()], ephemeral: true });
}

module.exports = { data, execute };
