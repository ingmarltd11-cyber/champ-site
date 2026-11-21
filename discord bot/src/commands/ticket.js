const { SlashCommandBuilder } = require('discord.js');
const ticketConfig = require('../core/ticketConfig');

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Change ticket categories, questions, panel text and limits with forms')
  .addSubcommandGroup((group) =>
    group
      .setName('question')
      .setDescription('Add, edit, remove or list the questions of a category')
      .addSubcommand((sub) => sub.setName('add').setDescription('Open a form to add a question'))
      .addSubcommand((sub) => sub.setName('edit').setDescription('Pick a question and edit it in a form'))
      .addSubcommand((sub) => sub.setName('remove').setDescription('Pick a question and remove it'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show every category with its questions'))
  )
  .addSubcommandGroup((group) =>
    group
      .setName('category')
      .setDescription('Add, edit, remove or list ticket categories')
      .addSubcommand((sub) => sub.setName('add').setDescription('Open a form to add a category'))
      .addSubcommand((sub) => sub.setName('edit').setDescription('Pick a category and edit it in a form'))
      .addSubcommand((sub) => sub.setName('remove').setDescription('Pick a category and remove it'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show every category'))
  )
  .addSubcommandGroup((group) =>
    group
      .setName('settings')
      .setDescription('Panel text and ticket limits')
      .addSubcommand((sub) => sub.setName('panel').setDescription('Edit the panel title, text and colour in a form'))
      .addSubcommand((sub) => sub.setName('limits').setDescription('Edit support role, max open, delay and rating in a form'))
  )
  .addSubcommandGroup((group) =>
    group
      .setName('panel')
      .setDescription('Add, edit, remove, list or post ticket panels')
      .addSubcommand((sub) => sub.setName('add').setDescription('Pick categories and create a panel in a form'))
      .addSubcommand((sub) => sub.setName('edit').setDescription('Edit a panel and its categories in a form'))
      .addSubcommand((sub) => sub.setName('remove').setDescription('Pick a panel and delete it'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show every ticket panel'))
      .addSubcommand((sub) => sub.setName('post').setDescription('Post a ticket panel in this channel'))
  );

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  return ticketConfig.execute(interaction, group, sub);
}

module.exports = { data, execute };
