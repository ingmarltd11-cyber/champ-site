const { SlashCommandBuilder } = require('discord.js');
const { siteUrl } = require('../utils/format');

const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to your Champ customer account')
  .addStringOption((option) =>
    option
      .setName('code')
      .setDescription('The 8-character code from your Champ dashboard')
      .setRequired(false)
      .setMinLength(6)
      .setMaxLength(32)
  );

async function execute(interaction) {
  const code = interaction.options.getString('code');
  const dashboard = `${siteUrl()}/dashboard.html`;

  if (!code) {
    return interaction.reply({
      content: `Open your dashboard at ${dashboard}, choose **Discord → Link Discord account**, and paste the code here with \`/link code:<code>\`.`,
      ephemeral: true,
    });
  }

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    return interaction.reply({
      content: 'Discord linking is unavailable because this bot has no token configured.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const response = await fetch(`${siteUrl()}/api/discord/bot/link`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        discord_id: interaction.user.id,
        username: interaction.user.username,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return interaction.editReply({
        content: data.detail || 'That code is invalid or has expired. Generate a new one on the dashboard.',
      });
    }
    return interaction.editReply({
      content: data.message || 'Discord linked to your Champ account.',
    });
  } catch (error) {
    return interaction.editReply({
      content: 'I could not reach the Champ site just now. Try again in a moment or open a ticket.',
    });
  }
}

module.exports = { data, execute };
