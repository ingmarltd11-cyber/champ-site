const { SlashCommandBuilder } = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const ticketStore = require('../utils/ticketStore');
const { closeTicketChannel } = require('../handlers/ticketInteractions');

const data = new SlashCommandBuilder()
  .setName('ticket-close')
  .setDescription('Close this ticket with an optional reason')
  .addStringOption((opt) =>
    opt.setName('reason').setDescription('Reason for closing the ticket').setRequired(false)
  );

async function execute(interaction) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });

  const isOpener = interaction.user.id === ticket.userId;
  const isStaff = isStaffMember(interaction.member, interaction.guild, config);
  if (!isOpener && !isStaff) {
    return interaction.reply({ content: '❌ Only the ticket opener or staff can close this ticket.', ephemeral: true });
  }

  const reason = interaction.options.getString('reason') || null;
  await interaction.reply('🔒 Closing ticket and generating transcript…');
  await closeTicketChannel(interaction.channel, config, { closerTag: interaction.user.tag, reason });
}

module.exports = { data, execute };
