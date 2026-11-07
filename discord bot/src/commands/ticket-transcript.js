const { SlashCommandBuilder } = require('discord.js');
const { handleTranscript } = require('../handlers/ticketInteractions');

const data = new SlashCommandBuilder()
  .setName('ticket-transcript')
  .setDescription('Export the current ticket as .txt + .html (staff)');

async function execute(interaction) {
  return handleTranscript(interaction);
}

module.exports = { data, execute };
