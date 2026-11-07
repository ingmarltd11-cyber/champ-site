const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const ticketStore = require('../utils/ticketStore');
const giveawayStore = require('../utils/giveawayStore');
const { formatUptime, siteUrl } = require('../utils/format');
const { version } = require('../../package.json');

const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Bot uptime, latency and live ticket/giveaway counts');

async function execute(interaction) {
  await interaction.deferReply();
  const client = interaction.client;
  const startedAt = client.startedAt || Date.now();
  const [stats, giveaways] = await Promise.all([
    ticketStore.getStats().catch(() => null),
    giveawayStore.listGiveaways({ activeOnly: true }).catch(() => []),
  ]);

  const storage = ticketStore.isSupabaseActive() ? 'Supabase' : 'JSON volume';
  const rating = stats?.avgRating ? `${stats.avgRating.toFixed(1)}/5 (${stats.ratingsTotal})` : 'no ratings yet';

  const embed = new EmbedBuilder()
    .setTitle('🛰️ Champ bot status')
    .setColor('#2EC4B6')
    .addFields(
      { name: 'Uptime', value: formatUptime(Date.now() - startedAt), inline: true },
      { name: 'Gateway ping', value: `${Math.max(0, Math.round(client.ws.ping))} ms`, inline: true },
      { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
      { name: 'Open tickets', value: String(stats?.openTotal ?? '—'), inline: true },
      { name: 'Closed tickets', value: String(stats?.closedTotal ?? '—'), inline: true },
      { name: 'Active giveaways', value: String(giveaways.length), inline: true },
      { name: 'Average rating', value: rating, inline: true },
      { name: 'Storage', value: storage, inline: true },
      { name: 'Version', value: `v${version}`, inline: true }
    )
    .setFooter({ text: 'Champ Client · status' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Website').setURL(siteUrl()).setStyle(ButtonStyle.Link)
  );

  return interaction.editReply({ embeds: [embed], components: [row] });
}

module.exports = { data, execute };
