'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const ticketTypes = require('../utils/ticketTypes');
const { getTicketConfig } = require('../config/loadConfig');
const { updateTicketSettings } = require('../utils/settings');
const { isStaffMember } = require('../utils/permissions');
const { view, clip } = require('./guiHelpers');
const { buildId, parseId } = require('./ids');
const panelStore = require('./panelStore');
const { postPanel } = require('./panelRuntime');
const { log } = require('../utils/logger');

const COLOUR = '#FFC93C';

function staffCheck(interaction) {
  if (isStaffMember(interaction.member, interaction.guild, getTicketConfig())) return true;
  view(interaction, { content: '❌ Only Champ staff can change ticket settings.' });
  return false;
}

function embed(title, description) {
  return new EmbedBuilder().setTitle(clip(title, 256)).setDescription(clip(description, 4000)).setColor(COLOUR);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function typeOptions(types) {
  return types.slice(0, 25).map((type) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(clip(type.label || type.id, 100))
      .setValue(type.id)
      .setDescription(clip(`${(type.questions || []).length} question(s) · ${type.description || type.id}`, 100))
      .setEmoji(type.emoji || '🎫')
  );
}

function questionOptions(type) {
  return (type.questions || []).slice(0, 25).map((question) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(clip(question.label || question.id, 100))
      .setValue(question.id)
      .setDescription(clip(`${question.style === 'paragraph' ? 'Paragraph' : 'Short'} · ${question.required === false ? 'optional' : 'required'}`, 100))
  );
}

function select(customId, placeholder, options) {
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(clip(placeholder, 150))
      .addOptions(options)
  );
}

function input(id, label, style, { required = true, placeholder, value, maxLength } = {}) {
  const builder = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(clip(label, 45))
    .setStyle(style)
    .setRequired(required);
  if (placeholder) builder.setPlaceholder(clip(placeholder, 100));
  if (maxLength) builder.setMaxLength(maxLength);
  if (value !== undefined && value !== null && String(value).trim() !== '') builder.setValue(clip(String(value), 4000));
  return builder;
}

function slug(value, fallback = 'item') {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 48) || fallback
  );
}

function uniqueId(existing, value) {
  const base = slug(value, 'question');
  const taken = new Set((existing || []).map((item) => item.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

async function execute(interaction, group, sub) {
  if (!staffCheck(interaction)) return;
  const key = `${group || ''}:${sub}`;
  switch (key) {
    case 'question:add':
      return startQuestionAdd(interaction);
    case 'question:edit':
      return startQuestionEdit(interaction);
    case 'question:remove':
      return startQuestionRemove(interaction);
    case 'question:list':
      return listQuestions(interaction);
    case 'category:add':
      return startCategoryAdd(interaction);
    case 'category:edit':
      return startCategoryEdit(interaction);
    case 'category:remove':
      return startCategoryRemove(interaction);
    case 'category:list':
      return listCategories(interaction);
    case 'settings:panel':
      return editPanelCopy(interaction);
    case 'settings:limits':
      return editLimits(interaction);
    case 'panel:post':
      return postPanelHere(interaction);
    default:
      return view(interaction, { content: 'Unknown ticket command.' });
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

async function startQuestionAdd(interaction) {
  const types = await ticketTypes.listTypes();
  if (!types.length) return view(interaction, { content: 'No categories yet. Add one with `/ticket category add`.' });
  return view(interaction, {
    embeds: [embed('❓ Add a question', 'Pick the category that should get the new question.')],
    components: [select(buildId('ticket-config', 'q-add-cat'), 'Choose a category...', typeOptions(types))],
  });
}

async function questionAddCategory(interaction, typeId) {
  const type = await ticketTypes.getType(typeId);
  if (!type) return view(interaction, { content: 'That category no longer exists.' });
  if ((type.questions || []).length >= 5) {
    return view(interaction, { content: `**${type.label}** already has the maximum of 5 questions.` });
  }
  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'q-add', type.id))
    .setTitle(clip(`Add question · ${type.label}`, 45))
    .addComponents(
      row(input('label', 'Question title', TextInputStyle.Short, { placeholder: 'e.g. Client version', maxLength: 45 })),
      row(
        input('placeholder', 'Placeholder', TextInputStyle.Short, {
          required: false,
          placeholder: 'e.g. Beta 0.9.9.1',
          maxLength: 100,
        })
      ),
      row(input('style', 'Type: short or paragraph', TextInputStyle.Short, { value: 'short', maxLength: 10 })),
      row(input('required', 'Required: yes or no', TextInputStyle.Short, { value: 'yes', maxLength: 5 }))
    );
  return interaction.showModal(modal);
}

async function questionAddSubmit(interaction, typeId) {
  const label = interaction.fields.getTextInputValue('label').trim();
  const style = /^paragraph$/i.test(interaction.fields.getTextInputValue('style').trim()) ? 'paragraph' : 'short';
  const required = !/^(no|false|nee|0)$/i.test(interaction.fields.getTextInputValue('required').trim());
  const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
  const type = await ticketTypes.getType(typeId);
  if (!type) throw new Error('That category no longer exists.');

  const question = {
    id: uniqueId(type.questions, label),
    label: clip(label, 45),
    style,
    required,
    maxLength: style === 'paragraph' ? 1000 : 120,
  };
  if (placeholder) question.placeholder = clip(placeholder, 100);

  await ticketTypes.addQuestion(typeId, question);
  return view(interaction, {
    embeds: [
      embed(
        '✅ Question added',
        `**${type.label}** now has **${(type.questions || []).length + 1}/5** questions.\n\n` +
          `**${question.label}**\n\`${question.id}\` · ${style} · ${required ? 'required' : 'optional'}`
      ),
    ],
  });
}

async function startQuestionEdit(interaction) {
  const types = await ticketTypes.listTypes();
  if (!types.length) return view(interaction, { content: 'No categories yet.' });
  return view(interaction, {
    embeds: [embed('✏️ Edit a question', 'Pick the category first.')],
    components: [select(buildId('ticket-config', 'q-edit-cat'), 'Choose a category...', typeOptions(types))],
  });
}

async function questionEditCategory(interaction, typeId) {
  const type = await ticketTypes.getType(typeId);
  if (!type) return view(interaction, { content: 'That category no longer exists.' });
  if (!(type.questions || []).length) return view(interaction, { content: `**${type.label}** has no questions.` });
  return view(interaction, {
    embeds: [embed('✏️ Edit a question', `Pick a question from **${type.label}**.`)],
    components: [
      select(buildId('ticket-config', 'q-edit-q', type.id), 'Choose a question...', questionOptions(type)),
    ],
  });
}

async function questionEditPick(interaction, typeId, questionId) {
  const type = await ticketTypes.getType(typeId);
  const question = (type?.questions || []).find((candidate) => candidate.id === questionId);
  if (!type || !question) return view(interaction, { content: 'That question no longer exists.' });

  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'q-edit', type.id, question.id))
    .setTitle(clip(`Edit · ${question.label}`, 45))
    .addComponents(
      row(input('label', 'Question title', TextInputStyle.Short, { value: question.label, maxLength: 45 })),
      row(
        input('placeholder', 'Placeholder', TextInputStyle.Short, {
          required: false,
          value: question.placeholder || '',
          maxLength: 100,
        })
      ),
      row(input('style', 'Type: short or paragraph', TextInputStyle.Short, { value: question.style || 'short', maxLength: 10 })),
      row(
        input('required', 'Required: yes or no', TextInputStyle.Short, {
          value: question.required === false ? 'no' : 'yes',
          maxLength: 5,
        })
      )
    );
  return interaction.showModal(modal);
}

async function questionEditSubmit(interaction, typeId, questionId) {
  const label = clip(interaction.fields.getTextInputValue('label').trim(), 45);
  const style = /^paragraph$/i.test(interaction.fields.getTextInputValue('style').trim()) ? 'paragraph' : 'short';
  const required = !/^(no|false|nee|0)$/i.test(interaction.fields.getTextInputValue('required').trim());
  const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
  const patch = { label, style, required, placeholder: clip(placeholder, 100), maxLength: style === 'paragraph' ? 1000 : 120 };
  await ticketTypes.updateQuestion(typeId, questionId, patch);
  return view(interaction, {
    embeds: [embed('✅ Question updated', `**${label}** (\`${questionId}\`) is saved.`)],
  });
}

async function startQuestionRemove(interaction) {
  const types = await ticketTypes.listTypes();
  if (!types.length) return view(interaction, { content: 'No categories yet.' });
  return view(interaction, {
    embeds: [embed('🗑️ Remove a question', 'Pick the category first.')],
    components: [select(buildId('ticket-config', 'q-del-cat'), 'Choose a category...', typeOptions(types))],
  });
}

async function questionRemoveCategory(interaction, typeId) {
  const type = await ticketTypes.getType(typeId);
  if (!type) return view(interaction, { content: 'That category no longer exists.' });
  if (!(type.questions || []).length) return view(interaction, { content: `**${type.label}** has no questions.` });
  return view(interaction, {
    embeds: [embed('🗑️ Remove a question', `Pick a question from **${type.label}**.`)],
    components: [
      select(buildId('ticket-config', 'q-del-q', type.id), 'Choose a question...', questionOptions(type)),
    ],
  });
}

async function questionRemovePick(interaction, typeId, questionId) {
  const type = await ticketTypes.getType(typeId);
  const question = (type?.questions || []).find((candidate) => candidate.id === questionId);
  if (!type || !question) return view(interaction, { content: 'That question no longer exists.' });
  return view(interaction, {
    embeds: [
      embed(
        '🗑️ Confirm removal',
        `Remove **${question.label}** from **${type.label}**?\n\nThe other questions stay. This cannot be undone.`
      ),
    ],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(buildId('ticket-config', 'q-del', type.id, question.id))
          .setLabel('Yes, remove')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildId('ticket-config', 'cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function questionRemoveConfirm(interaction, typeId, questionId) {
  await ticketTypes.removeQuestion(typeId, questionId);
  return view(interaction, { embeds: [embed('🗑️ Question removed', `\`${questionId}\` is gone from **${typeId}**.`)] });
}

async function listQuestions(interaction) {
  const types = await ticketTypes.listTypes();
  const embedBuilder = new EmbedBuilder()
    .setTitle('❓ Ticket questions')
    .setColor(COLOUR)
    .setFooter({ text: `${types.length} categories · /ticket question add to extend one` });
  if (!types.length) embedBuilder.setDescription('No categories are configured yet.');
  for (const type of types.slice(0, 10)) {
    const questions = (type.questions || []).map((question) => `\`${question.id}\` — ${question.label}`).join('\n');
    embedBuilder.addFields({
      name: clip(`${type.emoji || '🎫'} ${type.label} (${(type.questions || []).length}/5)`, 256),
      value: clip(questions || 'No questions — the ticket opens straight into a channel.', 1024),
    });
  }
  return view(interaction, { embeds: [embedBuilder] });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function startCategoryAdd(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'c-add'))
    .setTitle('Add ticket category')
    .addComponents(
      row(input('id', 'Category id', TextInputStyle.Short, { placeholder: 'e.g. buy-client', maxLength: 48 })),
      row(input('label', 'Title', TextInputStyle.Short, { placeholder: 'e.g. Buy Champ Client', maxLength: 100 })),
      row(input('emoji', 'Emoji', TextInputStyle.Short, { required: false, placeholder: '🛒', maxLength: 20 })),
      row(
        input('description', 'Dropdown description', TextInputStyle.Short, {
          required: false,
          placeholder: 'Shown under the title in the menu',
          maxLength: 100,
        })
      ),
      row(input('ping', 'Ping Support: yes or no', TextInputStyle.Short, { value: 'yes', maxLength: 5 }))
    );
  return interaction.showModal(modal);
}

async function categoryAddSubmit(interaction) {
  const id = slug(interaction.fields.getTextInputValue('id'), '');
  const label = clip(interaction.fields.getTextInputValue('label').trim(), 100);
  const emoji = interaction.fields.getTextInputValue('emoji').trim() || '🎫';
  const description = clip(interaction.fields.getTextInputValue('description').trim(), 100);
  const pingSupport = !/^(no|false|nee|0)$/i.test(interaction.fields.getTextInputValue('ping').trim());
  if (!id) throw new Error('A category needs an id with letters or numbers.');
  if (!label) throw new Error('A category needs a title.');

  await ticketTypes.addType({ id, label, emoji, description, pingSupport });
  return view(interaction, {
    embeds: [
      embed(
        '✅ Category added',
        `**${emoji} ${label}** (\`${id}\`) is saved.\n\nAdd questions with \`/ticket question add\`, then refresh the panel with \`/ticket panel post\`.`
      ),
    ],
  });
}

async function startCategoryEdit(interaction) {
  const types = await ticketTypes.listTypes();
  if (!types.length) return view(interaction, { content: 'No categories yet. Add one with `/ticket category add`.' });
  return view(interaction, {
    embeds: [embed('✏️ Edit a category', 'Pick the category to edit. Its id stays the same.')],
    components: [select(buildId('ticket-config', 'c-edit-cat'), 'Choose a category...', typeOptions(types))],
  });
}

async function categoryEditPick(interaction, typeId) {
  const type = await ticketTypes.getType(typeId);
  if (!type) return view(interaction, { content: 'That category no longer exists.' });
  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'c-edit', type.id))
    .setTitle(clip(`Edit · ${type.label}`, 45))
    .addComponents(
      row(input('label', 'Title', TextInputStyle.Short, { value: type.label, maxLength: 100 })),
      row(input('emoji', 'Emoji', TextInputStyle.Short, { required: false, value: type.emoji || '', maxLength: 20 })),
      row(
        input('description', 'Dropdown description', TextInputStyle.Short, {
          required: false,
          value: type.description || '',
          maxLength: 100,
        })
      ),
      row(
        input('role', 'Support role id (optional)', TextInputStyle.Short, {
          required: false,
          value: type.supportRoleId || '',
          maxLength: 25,
        })
      ),
      row(
        input('ping', 'Ping Support: yes or no', TextInputStyle.Short, {
          value: type.pingSupport === false ? 'no' : 'yes',
          maxLength: 5,
        })
      )
    );
  return interaction.showModal(modal);
}

async function categoryEditSubmit(interaction, typeId) {
  const label = clip(interaction.fields.getTextInputValue('label').trim(), 100);
  const emoji = interaction.fields.getTextInputValue('emoji').trim() || '🎫';
  const description = clip(interaction.fields.getTextInputValue('description').trim(), 100);
  const roleId = interaction.fields.getTextInputValue('role').replace(/[^0-9]/g, '');
  const pingSupport = !/^(no|false|nee|0)$/i.test(interaction.fields.getTextInputValue('ping').trim());
  if (!label) throw new Error('A category needs a title.');
  if (roleId && !interaction.guild.roles.cache.get(roleId)) throw new Error('That support role id is not in this server.');

  await ticketTypes.updateType(typeId, { label, emoji, description, supportRoleId: roleId, pingSupport });
  return view(interaction, { embeds: [embed('✅ Category updated', `**${emoji} ${label}** is saved.`)] });
}

async function startCategoryRemove(interaction) {
  const types = await ticketTypes.listTypes();
  if (!types.length) return view(interaction, { content: 'No categories yet.' });
  return view(interaction, {
    embeds: [embed('🗑️ Remove a category', 'Pick the category to delete. Existing ticket channels keep their history.')],
    components: [select(buildId('ticket-config', 'c-del-cat'), 'Choose a category...', typeOptions(types))],
  });
}

async function categoryRemovePick(interaction, typeId) {
  const type = await ticketTypes.getType(typeId);
  if (!type) return view(interaction, { content: 'That category no longer exists.' });
  return view(interaction, {
    embeds: [
      embed(
        '🗑️ Confirm removal',
        `Delete **${type.emoji || '🎫'} ${type.label}**?\n\nThe panel stops offering it immediately. Open ticket channels stay usable for staff.`
      ),
    ],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(buildId('ticket-config', 'c-del', type.id))
          .setLabel('Yes, delete')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildId('ticket-config', 'cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
}

async function categoryRemoveConfirm(interaction, typeId) {
  await ticketTypes.removeType(typeId);
  return view(interaction, { embeds: [embed('🗑️ Category removed', `\`${typeId}\` is gone. Refresh the panel with \`/ticket panel post\`.`)] });
}

async function listCategories(interaction) {
  const types = await ticketTypes.listTypes();
  const embedBuilder = new EmbedBuilder()
    .setTitle('🎫 Ticket categories')
    .setColor(COLOUR)
    .setFooter({ text: `${types.length} categories · /ticket category add to create one` });
  if (!types.length) embedBuilder.setDescription('No categories are configured yet.');
  for (const type of types.slice(0, 15)) {
    embedBuilder.addFields({
      name: clip(`${type.emoji || '🎫'} ${type.label}`, 256),
      value: clip(
        `\`${type.id}\` · ${(type.questions || []).length} question(s) · ping ${type.pingSupport === false ? 'off' : 'on'}${type.ai ? ' · AI' : ''}`,
        1024
      ),
      inline: true,
    });
  }
  return view(interaction, { embeds: [embedBuilder] });
}

// ---------------------------------------------------------------------------
// Panel copy and limits
// ---------------------------------------------------------------------------

async function editPanelCopy(interaction) {
  const config = getTicketConfig();
  const panel = config.panel || {};
  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'settings'))
    .setTitle('Ticket panel text')
    .addComponents(
      row(input('title', 'Panel title', TextInputStyle.Short, { value: panel.title || '', maxLength: 256 })),
      row(input('description', 'Panel description', TextInputStyle.Paragraph, { value: panel.description || '', maxLength: 2000 })),
      row(input('placeholder', 'Dropdown placeholder', TextInputStyle.Short, { value: panel.placeholder || '', maxLength: 150 })),
      row(input('footer', 'Footer', TextInputStyle.Short, { required: false, value: panel.footer || '', maxLength: 200 })),
      row(input('color', 'Colour (#FFC93C)', TextInputStyle.Short, { required: false, value: panel.color || COLOUR, maxLength: 7 }))
    );
  return interaction.showModal(modal);
}

async function settingsPanelSubmit(interaction) {
  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim();
  const color = interaction.fields.getTextInputValue('color').trim();
  if (!title) throw new Error('The panel needs a title.');
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Colour must look like #FFC93C.');

  await updateTicketSettings({
    panel: {
      title,
      description,
      placeholder,
      ...(footer ? { footer } : {}),
      ...(color ? { color } : {}),
    },
  });
  return view(interaction, {
    embeds: [embed('✅ Panel text saved', 'Refresh the panel to show the new text: `/ticket panel post` or **Control panel → Panels → Refresh**.')],
  });
}

async function editLimits(interaction) {
  const config = getTicketConfig();
  const settings = config.settings || {};
  const modal = new ModalBuilder()
    .setCustomId(buildId('ticket-config', 'limits'))
    .setTitle('Ticket limits')
    .addComponents(
      row(
        input('role', 'Support role name', TextInputStyle.Short, {
          value: settings.defaultSupportRoleName || 'Support',
          maxLength: 100,
        })
      ),
      row(
        input('maxOpen', 'Max open tickets per member', TextInputStyle.Short, {
          value: String(settings.maxOpenTicketsPerUser ?? 1),
          maxLength: 2,
        })
      ),
      row(
        input('delay', 'Delete delay after close (seconds)', TextInputStyle.Short, {
          value: String(settings.deleteDelaySeconds ?? 5),
          maxLength: 3,
        })
      ),
      row(
        input('format', 'Transcript: txt, html or both', TextInputStyle.Short, {
          value: settings.transcriptFormat || 'both',
          maxLength: 4,
        })
      ),
      row(
        input('rating', 'Rating: on or off', TextInputStyle.Short, {
          value: settings.rating?.enabled === false ? 'off' : 'on',
          maxLength: 3,
        })
      )
    );
  return interaction.showModal(modal);
}

async function settingsLimitsSubmit(interaction) {
  const roleName = interaction.fields.getTextInputValue('role').trim();
  const maxOpen = Number(interaction.fields.getTextInputValue('maxOpen').trim());
  const delay = Number(interaction.fields.getTextInputValue('delay').trim());
  const format = interaction.fields.getTextInputValue('format').trim().toLowerCase();
  const rating = !/^(off|no|false|nee|0)$/i.test(interaction.fields.getTextInputValue('rating').trim());
  if (!roleName) throw new Error('A support role name is required.');
  if (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 10) throw new Error('Max open tickets must be 1–10.');
  if (!Number.isFinite(delay) || delay < 0 || delay > 120) throw new Error('Delete delay must be 0–120 seconds.');
  if (!['txt', 'html', 'both'].includes(format)) throw new Error('Transcript format must be txt, html or both.');

  await updateTicketSettings({
    settings: {
      defaultSupportRoleName: roleName,
      maxOpenTicketsPerUser: maxOpen,
      deleteDelaySeconds: delay,
      transcriptFormat: format,
      rating: { enabled: rating },
    },
  });
  return view(interaction, { embeds: [embed('✅ Limits saved', 'New tickets use these settings immediately.')] });
}

async function postPanelHere(interaction) {
  if (!interaction.channel?.isTextBased()) return view(interaction, { content: 'Use this in a text channel.' });
  await interaction.deferReply({ ephemeral: true });
  const panel = await panelStore.createPanel({
    guildId: interaction.guildId,
    type: 'tickets',
    name: 'tickets',
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
  });
  const message = await postPanel(interaction.client, panel);
  return interaction.editReply(`✅ Ticket panel posted: ${message.url}`);
}

// ---------------------------------------------------------------------------
// Component router
// ---------------------------------------------------------------------------

async function handleComponent(interaction) {
  if (!staffCheck(interaction)) return;
  const parts = parseId(interaction.customId);
  const action = parts[1];

  try {
    if (interaction.isStringSelectMenu()) {
      switch (action) {
        case 'q-add-cat':
          return questionAddCategory(interaction, interaction.values[0]);
        case 'q-edit-cat':
          return questionEditCategory(interaction, interaction.values[0]);
        case 'q-edit-q':
          return questionEditPick(interaction, parts[2], interaction.values[0]);
        case 'q-del-cat':
          return questionRemoveCategory(interaction, interaction.values[0]);
        case 'q-del-q':
          return questionRemovePick(interaction, parts[2], interaction.values[0]);
        case 'c-edit-cat':
          return categoryEditPick(interaction, interaction.values[0]);
        case 'c-del-cat':
          return categoryRemovePick(interaction, interaction.values[0]);
      }
    }

    if (interaction.isButton()) {
      if (action === 'cancel') return view(interaction, { embeds: [embed('Cancelled', 'Nothing was changed.')] });
      if (action === 'q-del') return questionRemoveConfirm(interaction, parts[2], parts[3]);
      if (action === 'c-del') return categoryRemoveConfirm(interaction, parts[2]);
    }

    if (interaction.isModalSubmit()) {
      switch (action) {
        case 'q-add':
          return questionAddSubmit(interaction, parts[2]);
        case 'q-edit':
          return questionEditSubmit(interaction, parts[2], parts[3]);
        case 'c-add':
          return categoryAddSubmit(interaction);
        case 'c-edit':
          return categoryEditSubmit(interaction, parts[2]);
        case 'settings':
          return settingsPanelSubmit(interaction);
        case 'limits':
          return settingsLimitsSubmit(interaction);
      }
    }

    return view(interaction, { content: 'That ticket form is out of date. Run `/ticket` again.' });
  } catch (err) {
    log.warn('tickets', `ticket config failed: ${err.message}`);
    return view(interaction, { content: `❌ ${err.message}` });
  }
}

module.exports = {
  execute,
  handleComponent,
  slug,
  uniqueId,
};
