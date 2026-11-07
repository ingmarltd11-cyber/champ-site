const { SlashCommandBuilder } = require('discord.js');
const { handleAddUser } = require('../handlers/ticketInteractions');

const data = new SlashCommandBuilder()
  .setName('ticket-add')
  .setDescription('Let another member see and reply in this ticket (staff)')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The member to add to this ticket').setRequired(true)
  );

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  return handleAddUser(interaction, user);
}

module.exports = { data, execute };
