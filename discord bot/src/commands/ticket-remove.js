const { SlashCommandBuilder } = require('discord.js');
const { handleRemoveUser } = require('../handlers/ticketInteractions');

const data = new SlashCommandBuilder()
  .setName('ticket-remove')
  .setDescription('Remove a member from this ticket (staff)')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The member to remove from this ticket').setRequired(true)
  );

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  return handleRemoveUser(interaction, user);
}

module.exports = { data, execute };
