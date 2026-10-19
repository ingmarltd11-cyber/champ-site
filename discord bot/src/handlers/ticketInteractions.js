const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { resolveSupportRole, isStaffMember } = require('../utils/permissions');
const ticketStore = require('../utils/ticketStore');
const { generateTranscripts } = require('../utils/transcript');
const { logTicketEvent } = require('../utils/ticketLog');

function sanitize(name) {
  return String(name || 'user').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80);
}

function buildChannelName(type, user, config) {
  const pattern = config.settings.naming || '{emoji}-{username}';
  return pattern
    .replace('{emoji}', type.emoji || '🎫')
    .replace('{username}', sanitize(user.username))
    .replace('{type}', type.id)
    .slice(0, 90);
}

// Step 1: the user selects a ticket category from the menu.
async function handleSelect(interaction) {
  const config = getTicketConfig();
  const typeId = interaction.values[0];
  const type = config.types.find((t) => t.id === typeId);
  if (!type) return interaction.reply({ content: 'Unknown ticket category.', ephemeral: true });

  const limit = type.maxOpen ?? config.settings.maxOpenTicketsPerUser ?? 1;
  const openCount = await ticketStore.countOpenByUser(interaction.user.id);
  if (openCount >= limit) {
    return interaction.reply({
      content: '❌ You already have an open ticket. Please close it before opening another.',
      ephemeral: true,
    });
  }

  // Create the ticket channel immediately when this category has no questions.
  if (!type.questions || type.questions.length === 0) {
    await interaction.deferReply({ ephemeral: true });
    const channel = await createTicketChannel(interaction, type, {});
    return interaction.editReply(`✅ Ticket created: ${channel}`);
  }

  // Otherwise, show a modal with the configured questions first.
  const modal = new ModalBuilder()
    .setCustomId(`ticket-modal-${type.id}`)
    .setTitle(type.label.slice(0, 45));

  for (const q of type.questions.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(q.id)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required !== false);
    if (q.placeholder) input.setPlaceholder(String(q.placeholder).slice(0, 100));
    if (q.maxLength) input.setMaxLength(Math.min(Number(q.maxLength) || 1000, 4000));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  await interaction.showModal(modal);
}

// Step 2: create the ticket channel and include the submitted answers.
async function handleModalSubmit(interaction) {
  const config = getTicketConfig();
  const typeId = interaction.customId.replace('ticket-modal-', '');
  const type = config.types.find((t) => t.id === typeId);
  if (!type) return interaction.reply({ content: 'Unknown ticket category.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const answers = {};
  for (const q of type.questions || []) {
    answers[q.id] = interaction.fields.getTextInputValue(q.id);
  }

  const channel = await createTicketChannel(interaction, type, answers);
  await interaction.editReply(`✅ Ticket created: ${channel}`);
}

async function createTicketChannel(interaction, type, answers) {
  const config = getTicketConfig();
  const guild = interaction.guild;
  const user = interaction.user;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    },
  ];
  const supportRole = resolveSupportRole(guild, type, config);
  if (supportRole) {
    overwrites.push({
      id: supportRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
  }

  const categoryId = config.settings.ticketCategoryId;
  const channel = await guild.channels.create({
    name: buildChannelName(type, user, config),
    type: ChannelType.GuildText,
    parent: categoryId && !categoryId.includes('_ID') ? categoryId : undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket from ${user.tag} | type: ${type.id}`,
  });

  await ticketStore.addTicket(channel.id, { guildId: guild.id, userId: user.id, typeId: type.id, answers });

  const embed = new EmbedBuilder()
    .setTitle(`${type.emoji || '🎫'} ${type.label}`)
    .setDescription(`Welcome ${user}, a team member will be with you as soon as possible.`)
    .setColor(config.panel.color)
    .setTimestamp();

  for (const [key, value] of Object.entries(answers)) {
    const question = (type.questions || []).find((q) => q.id === key);
    embed.addFields({ name: question?.label || key, value: String(value || '-').slice(0, 1024) });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket-claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket-close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );

  const pingContent = supportRole && type.pingSupport !== false ? `<@&${supportRole.id}>` : '';
  await channel.send({ content: pingContent, embeds: [embed], components: [row] });

  await logTicketEvent(guild, config, {
    title: `📩 Ticket opened: ${type.label}`,
    color: '#4D9FFF',
    fields: [
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Opened by', value: `${user.tag}`, inline: true },
      { name: 'Type', value: type.label, inline: true },
    ],
  });

  return channel;
}

async function handleClaim(interaction) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff members can claim tickets.', ephemeral: true });
  }

  await ticketStore.claimTicket(interaction.channel.id, interaction.user.id);
  await interaction.reply({ content: `🙋 Ticket claimed by ${interaction.user}.` });
  await logTicketEvent(interaction.guild, config, {
    title: '🙋 Ticket claimed',
    color: '#B26AE0',
    fields: [
      { name: 'Channel', value: `${interaction.channel}`, inline: true },
      { name: 'Claimed by', value: `${interaction.user.tag}`, inline: true },
    ],
  });
}

// Shared close logic used by the button, /ticket-close, and automatic closure.
async function closeTicketChannel(channel, config, { closerTag = 'system', reason = null } = {}) {
  const ticket = await ticketStore.getTicket(channel.id);
  if (!ticket) return null;

  const format = config.settings.transcriptFormat || 'both';
  const { txt, html, text } = await generateTranscripts(channel, format);
  const files = [txt, html].filter(Boolean);

  // Send the transcript to the ticket opener when enabled.
  if (config.settings.sendTranscriptDm !== false) {
    try {
      const opener = await channel.client.users.fetch(ticket.userId);
      await opener.send({
        content:
          `📄 Here is the transcript of your **${ticket.typeId}** ticket in **${channel.guild.name}**.` +
          (reason ? `\nReason: ${reason}` : ''),
        files,
      });
    } catch {
      await channel.send('⚠️ Could not send the transcript by DM (DMs may be closed). The transcript remains saved by the bot.').catch(() => {});
    }

    // Ask for a rating by DM when enabled for this ticket type.
    const type = config.types.find((t) => t.id === ticket.typeId);
    if (config.settings.rating?.enabled && type?.ratingEnabled !== false) {
      try {
        const opener = await channel.client.users.fetch(ticket.userId);
        const row = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map((n) =>
            new ButtonBuilder().setCustomId(`ticket-rate:${channel.id}:${n}`).setLabel(String(n)).setEmoji('⭐').setStyle(ButtonStyle.Secondary)
          )
        );
        await opener.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(config.settings.rating.title || '⭐ Rate your support')
              .setDescription(config.settings.rating.message || 'How satisfied are you?')
              .setColor(config.panel.color),
          ],
          components: [row],
        });
      } catch {
        /* Skip rating if DMs are closed. */
      }
    }
  }

  await ticketStore.closeTicket(channel.id, { transcript: text });

  await logTicketEvent(channel.guild, config, {
    title: '🔒 Ticket closed',
    color: '#FF4D5E',
    fields: [
      { name: 'Channel', value: `#${channel.name}`, inline: true },
      { name: 'Closed by', value: closerTag, inline: true },
      ...(reason ? [{ name: 'Reason', value: reason }] : []),
    ],
  });

  const delay = (config.settings.deleteDelaySeconds ?? 5) * 1000;
  setTimeout(() => channel.delete().catch(() => {}), delay);
  return { txt, html };
}

async function handleClose(interaction) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });

  const isOpener = interaction.user.id === ticket.userId;
  const isStaff = isStaffMember(interaction.member, interaction.guild, config);
  if (!isOpener && !isStaff) {
    return interaction.reply({ content: '❌ Only the ticket opener or staff can close this ticket.', ephemeral: true });
  }

  await interaction.reply('🔒 Closing ticket and generating transcript…');
  await closeTicketChannel(interaction.channel, config, { closerTag: interaction.user.tag });
}

// Rating: click a star to open an optional comment modal.
async function handleRateButton(interaction) {
  const [, channelId, stars] = interaction.customId.split(':');
  const ticket = await ticketStore.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: 'This ticket no longer exists.', ephemeral: true });
  if (interaction.user.id !== ticket.userId) {
    return interaction.reply({ content: '❌ Only the ticket opener can submit a rating.', ephemeral: true });
  }
  const modal = new ModalBuilder()
    .setCustomId(`ticket-rate-modal:${channelId}:${stars}`)
    .setTitle(`Rating: ${stars} star${stars === '1' ? '' : 's'}`);
  const input = new TextInputBuilder()
    .setCustomId('comment')
    .setLabel('Comment (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleRateModal(interaction) {
  const config = getTicketConfig();
  const [, channelId, stars] = interaction.customId.split(':');
  const comment = interaction.fields.getTextInputValue('comment') || null;
  await ticketStore.setRating(channelId, Number(stars), comment);
  await interaction.reply({ content: `✅ Thanks for your rating (${stars} ⭐)!`, ephemeral: true });
  await logTicketEvent(interaction.guild, config, {
    title: `⭐ New rating: ${stars}/5`,
    color: '#FFC93C',
    fields: [
      { name: 'Ticket', value: channelId, inline: true },
      { name: 'From', value: interaction.user.tag, inline: true },
      ...(comment ? [{ name: 'Comment', value: comment.slice(0, 1024) }] : []),
    ],
  });
}

module.exports = {
  handleSelect,
  handleModalSubmit,
  handleClaim,
  handleClose,
  handleRateButton,
  handleRateModal,
  closeTicketChannel,
};
