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
  AttachmentBuilder,
} = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { resolveSupportRole, isStaffMember } = require('../utils/permissions');
const ticketStore = require('../utils/ticketStore');
const { generateTranscripts } = require('../utils/transcript');
const { saveTranscript } = require('../utils/transcriptStore');
const { logTicketEvent } = require('../utils/ticketLog');
const { log } = require('../utils/logger');

const COOLDOWN_MS = 20 * 1000;
const cooldowns = new Map();

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

function staffRoleIds(config, type) {
  return [
    ...new Set(
      [type?.supportRoleId, config?.settings?.supportRoleId, ...(config?.settings?.staffRoleIds || [])].filter(Boolean)
    ),
  ];
}

function cloneFiles(files) {
  return files.filter(Boolean).map((file) => new AttachmentBuilder(file.attachment, { name: file.name }));
}

function openButtonRow(type) {
  const row = new ActionRowBuilder();
  if (type?.claimEnabled !== false) {
    row.addComponents(
      new ButtonBuilder().setCustomId('ticket-claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Primary)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('ticket-transcript')
      .setLabel('Transcript')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket-close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  return row;
}

function fail(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
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

  if (!type.questions || type.questions.length === 0) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await createTicketChannel(interaction, type, {});
      return interaction.editReply(`✅ Ticket created: ${channel}`);
    } catch (err) {
      log.warn('tickets', `could not open a ticket: ${err.message}`);
      return interaction.editReply(err.userMessage || 'Could not create the ticket. Please try again.');
    }
  }

  const modal = new ModalBuilder().setCustomId(`ticket-modal-${type.id}`).setTitle(type.label.slice(0, 45));
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

  try {
    const channel = await createTicketChannel(interaction, type, answers);
    await interaction.editReply(`✅ Ticket created: ${channel}`);
  } catch (err) {
    log.warn('tickets', `could not open a ticket: ${err.message}`);
    await interaction.editReply(err.userMessage || 'Could not create the ticket. Please try again.');
  }
}

async function createTicketChannel(interaction, type, answers) {
  const config = getTicketConfig();
  const guild = interaction.guild;
  const user = interaction.user;
  if (!guild) throw fail('Tickets can only be opened inside the Discord server.');

  const me = guild.members.me;
  if (!me) throw fail('I am not in this server, so I cannot create a ticket channel.');
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw fail('I need the **Manage Channels** permission to open a ticket. Please tell an admin.');
  }

  const limit = type.maxOpen ?? config.settings.maxOpenTicketsPerUser ?? 1;
  const openCount = await ticketStore.countOpenByUser(user.id);
  if (openCount >= limit) {
    throw fail('❌ You already have an open ticket. Please close it before opening another.');
  }

  const now = Date.now();
  for (const [id, at] of cooldowns) if (now - at > 5 * 60 * 1000) cooldowns.delete(id);
  const last = cooldowns.get(user.id);
  if (last && now - last < COOLDOWN_MS) {
    throw fail(`Please wait ${Math.ceil((COOLDOWN_MS - (now - last)) / 1000)}s before opening another ticket.`);
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  const supportRole = resolveSupportRole(guild, type, config);
  for (const roleId of staffRoleIds(config, type)) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  const categoryId = config.settings.ticketCategoryId;
  const category =
    categoryId && !String(categoryId).includes('_ID') ? guild.channels.cache.get(categoryId) : null;
  if (categoryId && !String(categoryId).includes('_ID') && !category) {
    log.warn('tickets', `ticket category ${categoryId} does not exist; opening without one`);
  }

  const channel = await guild.channels.create({
    name: buildChannelName(type, user, config),
    type: ChannelType.GuildText,
    parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket from ${user.tag} (${user.id}) | type: ${type.id}`,
  });

  try {
    await ticketStore.addTicket(channel.id, {
      guildId: guild.id,
      userId: user.id,
      typeId: type.id,
      answers,
    });
  } catch (err) {
    await channel.delete().catch(() => {});
    throw err;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${type.emoji || '🎫'} ${type.label}`)
    .setDescription(
      `Welcome ${user}, a team member will be with you as soon as possible.\n\n` +
        `Describe the issue in this channel. Opening a second ticket does not speed things up.`
    )
    .setColor(type.color || config.panel.color)
    .setTimestamp()
    .setFooter({ text: config.panel.footer || 'Champ Client Support' });

  for (const [key, value] of Object.entries(answers)) {
    const question = (type.questions || []).find((q) => q.id === key);
    embed.addFields({ name: question?.label || key, value: String(value || '-').slice(0, 1024) });
  }

  const pingContent = supportRole && type.pingSupport !== false ? `<@&${supportRole.id}>` : '';
  await channel.send({ content: pingContent || undefined, embeds: [embed], components: [openButtonRow(type)] });

  cooldowns.set(user.id, Date.now());

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
  if (ticket.status === 'closed') {
    return interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
  }
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff members can claim tickets.', ephemeral: true });
  }
  if (ticket.claimedBy === interaction.user.id) {
    return interaction.reply({ content: 'You already claimed this ticket.', ephemeral: true });
  }
  if (ticket.claimedBy) {
    return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
  }

  await ticketStore.claimTicket(interaction.channel.id, interaction.user.id);
  await interaction.channel
    .setTopic(`Ticket from <@${ticket.userId}> | type: ${ticket.typeId} | claimed by ${interaction.user.tag}`)
    .catch(() => {});
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
async function closeTicketChannel(channel, config, { closerTag = 'system', closerId = null, reason = null } = {}) {
  const ticket = await ticketStore.getTicket(channel.id);
  if (!ticket) return null;
  if (ticket.status === 'closed') return { alreadyClosed: true };

  const format = config.settings.transcriptFormat || 'both';
  const { txt, html, text, htmlText, name, messages } = await generateTranscripts(channel, format, {
    closedBy: closerTag,
    reason,
  });
  const files = [txt, html].filter(Boolean);
  const savedPath = await saveTranscript(channel, htmlText, { name });

  // Archive first: the DM may be closed, but the log keeps a copy either way.
  const archiveId = config.settings.transcriptChannelId || config.settings.logChannelId;
  if (archiveId && !String(archiveId).includes('_ID')) {
    try {
      const archive =
        channel.guild.channels.cache.get(archiveId) || (await channel.guild.channels.fetch(archiveId));
      if (archive?.isTextBased()) {
        await archive.send({
          content: `📄 Transcript for **#${channel.name}** — ${messages} messages.`,
          embeds: [
            new EmbedBuilder()
              .setTitle('📄 Ticket transcript')
              .setColor(config.panel.color || '#FFC93C')
              .addFields(
                { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
                { name: 'Type', value: ticket.typeId, inline: true },
                { name: 'Closed by', value: closerTag, inline: true },
                ...(reason ? [{ name: 'Reason', value: String(reason).slice(0, 1024) }] : []),
                ...(savedPath ? [{ name: 'Saved on disk', value: `\`${savedPath}\`` }] : [])
              )
              .setTimestamp(),
          ],
          files: cloneFiles(files),
        });
      }
    } catch (err) {
      log.warn('tickets', `could not archive the transcript: ${err.message}`);
    }
  }

  // Send the transcript to the ticket opener when enabled.
  let dmSent = false;
  if (config.settings.sendTranscriptDm !== false) {
    try {
      const opener = await channel.client.users.fetch(ticket.userId);
      await opener.send({
        content:
          `📄 Here is the transcript of your **${ticket.typeId}** ticket in **${channel.guild.name}**.` +
          (reason ? `\nReason: ${reason}` : ''),
        files: cloneFiles(files),
      });
      dmSent = true;
    } catch {
      await channel
        .send('⚠️ Could not send the transcript by DM (DMs may be closed). Staff keep a copy in the transcript log.')
        .catch(() => {});
    }
  }

  // Ask for a rating by DM when enabled for this ticket type.
  const type = config.types.find((t) => t.id === ticket.typeId);
  if (
    dmSent &&
    config.settings.rating?.enabled &&
    type?.ratingEnabled !== false &&
    ticket.rating === null
  ) {
    try {
      const opener = await channel.client.users.fetch(ticket.userId);
      const row = new ActionRowBuilder().addComponents(
        [1, 2, 3, 4, 5].map((n) =>
          new ButtonBuilder()
            .setCustomId(`ticket-rate:${channel.id}:${n}`)
            .setLabel(String(n))
            .setEmoji('⭐')
            .setStyle(ButtonStyle.Secondary)
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
      /* Skip the rating if DMs are closed. */
    }
  }

  await ticketStore.closeTicket(channel.id, { transcript: text });

  await logTicketEvent(channel.guild, config, {
    title: '🔒 Ticket closed',
    color: '#FF4D5E',
    fields: [
      { name: 'Channel', value: `#${channel.name}`, inline: true },
      { name: 'Closed by', value: closerTag, inline: true },
      ...(closerId ? [{ name: 'Closed by (id)', value: String(closerId), inline: true }] : []),
      ...(reason ? [{ name: 'Reason', value: String(reason).slice(0, 1024) }] : []),
    ],
  });

  const delay = Math.min(120, Math.max(0, Number(config.settings.deleteDelaySeconds ?? 5))) * 1000;
  setTimeout(() => channel.delete().catch(() => {}), delay);
  return { txt, html, text, messages, savedPath };
}

async function handleClose(interaction) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (ticket.status === 'closed') {
    return interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
  }

  const isOpener = interaction.user.id === ticket.userId;
  const isStaff = isStaffMember(interaction.member, interaction.guild, config);
  if (!isOpener && !isStaff) {
    return interaction.reply({ content: '❌ Only the ticket opener or staff can close this ticket.', ephemeral: true });
  }

  await interaction.reply({ content: '🔒 Closing ticket and generating the transcript…', ephemeral: true });
  await closeTicketChannel(interaction.channel, config, {
    closerTag: interaction.user.tag,
    closerId: interaction.user.id,
  });
}

async function handleTranscript(interaction) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff can export a transcript.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const { txt, html, htmlText, name, messages } = await generateTranscripts(interaction.channel, 'both', {
      closedBy: interaction.user.tag,
    });
    await saveTranscript(interaction.channel, htmlText, { name });
    await interaction.editReply({
      content: `📄 ${messages} messages, exported now. This copy is only visible to you.`,
      files: [txt, html].filter(Boolean),
    });
  } catch (err) {
    log.warn('tickets', `transcript button failed: ${err.message}`);
    await interaction.editReply('Could not read the messages in this channel.');
  }
}

async function handleAddUser(interaction, user) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff can add members to a ticket.', ephemeral: true });
  }
  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });
  return interaction.reply({ content: `✅ ${user} can now see and reply in this ticket.`, ephemeral: true });
}

async function handleRemoveUser(interaction, user) {
  const config = getTicketConfig();
  const ticket = await ticketStore.getTicket(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (!isStaffMember(interaction.member, interaction.guild, config)) {
    return interaction.reply({ content: '❌ Only staff can remove members from a ticket.', ephemeral: true });
  }
  if (user.id === ticket.userId) {
    return interaction.reply({ content: 'Use Close to end the ticket for its opener.', ephemeral: true });
  }
  await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
  return interaction.reply({ content: `✅ Removed ${user} from this ticket.`, ephemeral: true });
}

// Rating: click a star to open an optional comment modal.
async function handleRateButton(interaction) {
  const [, channelId, stars] = interaction.customId.split(':');
  const ticket = await ticketStore.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: 'This ticket no longer exists.', ephemeral: true });
  if (interaction.user.id !== ticket.userId) {
    return interaction.reply({ content: '❌ Only the ticket opener can submit a rating.', ephemeral: true });
  }
  if (ticket.rating !== null) {
    return interaction.reply({ content: `You already rated this ticket (${ticket.rating}/5). Thank you!`, ephemeral: true });
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
  const [, channelId, rawStars] = interaction.customId.split(':');
  const stars = Math.max(1, Math.min(5, Number(rawStars) || 0));
  const ticket = await ticketStore.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: 'This ticket no longer exists.', ephemeral: true });
  if (ticket.rating !== null) {
    return interaction.reply({ content: `You already rated this ticket (${ticket.rating}/5).`, ephemeral: true });
  }
  const comment = interaction.fields.getTextInputValue('comment') || null;
  await ticketStore.setRating(channelId, stars, comment);
  await interaction.reply({ content: `✅ Thanks for your rating (${stars} ⭐)!`, ephemeral: true });
  await interaction.message?.edit({ components: [] }).catch(() => {});
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
  handleTranscript,
  handleAddUser,
  handleRemoveUser,
  handleRateButton,
  handleRateModal,
  closeTicketChannel,
  createTicketChannel,
};
