const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const ticketStore = require('../utils/ticketStore');

const data = new SlashCommandBuilder()
  .setName('ticket-stats')
  .setDescription('View ticket statistics (open/closed, ratings, top staff)');

async function execute(interaction) {
  const config = getTicketConfig();
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff can view ticket statistics.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const stats = await ticketStore.getStats();
  const typeName = (id) => config.types.find((t) => t.id === id)?.label || id;

  const embed = new EmbedBuilder()
    .setTitle('📊 Ticket statistics')
    .setColor(config.panel.color)
    .setTimestamp()
    .addFields(
      { name: 'Open tickets', value: String(stats.openTotal), inline: true },
      { name: 'Closed tickets', value: String(stats.closedTotal), inline: true },
      {
        name: 'Average rating',
        value: stats.avgRating ? `${stats.avgRating.toFixed(1)} ⭐ (${stats.ratingsTotal} ratings)` : 'none yet',
        inline: true,
      }
    );

  const openLines = Object.entries(stats.openByType).map(([id, n]) => `${typeName(id)}: **${n}**`);
  embed.addFields({ name: 'Open per type', value: openLines.length ? openLines.join('\n') : '—' });

  if (stats.topStaff.length) {
    const lines = [];
    for (const [staffId, count] of stats.topStaff) {
      const user = await interaction.client.users.fetch(staffId).catch(() => null);
      lines.push(`${user ? user.tag : staffId}: **${count}** claimed`);
    }
    embed.addFields({ name: '🏆 Top staff (claims)', value: lines.join('\n') });
  }

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };
