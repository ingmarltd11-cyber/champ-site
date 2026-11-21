'use strict';

const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const panelStore = require('../core/panelStore');
const controlStore = require('../core/controlStore');
const { log } = require('../utils/logger');

// Only the owner may use destructive chat actions and only the owner may add the bot to a
// server. Set OWNER_IDS for a hard id allowlist; otherwise the usernames below are matched.
const OWNER_USERNAMES = ['silvan', 'sora_developing'];
const CONFIRM_TTL_MS = 2 * 60 * 1000;
const pending = new Map();

function splitEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function ownerIds() {
  return splitEnv('OWNER_IDS');
}

function ownerGuildIds() {
  return splitEnv('OWNER_GUILD_IDS');
}

function isOwner(user) {
  if (!user) return false;
  const ids = ownerIds();
  if (ids.length) return ids.includes(String(user.id));
  const names = [user.username, user.globalName]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return names.some((name) => OWNER_USERNAMES.includes(name));
}

// A guild already known to the bot (panel/control record) is allowed, so re-adding the bot to
// the owner's own server never fails on a username change. New unknown guilds must belong to the
// owner, or be listed in OWNER_GUILD_IDS.
async function isOwnerGuild(guild) {
  if (!guild) return false;
  const allowed = ownerGuildIds();
  if (allowed.length) return allowed.includes(String(guild.id));
  if (controlStore.get(guild.id)) return true;
  const panels = await panelStore.listPanels({ guildId: guild.id }).catch(() => []);
  if (panels.length) return true;
  if (ownerIds().includes(String(guild.ownerId))) return true;
  const owner = await guild.fetchOwner().catch(() => null);
  return Boolean(owner?.user && isOwner(owner.user));
}

const ASK = '(?:(?:can|could|would)\\s+you\\s+|please\\s+|kun\\s+je\\s+|kan\\s+je\\s+|wil\\s+je\\s+)?';

function rule(action, pattern) {
  return { action, re: new RegExp(`^${ASK}${pattern}`, 'i') };
}

const ACTIONS = [
  rule('delete-ticket', '(?:delete|remove|close and delete)\\s+(?:this\\s+|the\\s+)?ticket\\b'),
  rule('delete-ticket', '(?:verwijder|sluit en verwijder)\\s+(?:dit\\s+|deze\\s+)?ticket\\b'),
  rule('delete-messages', '(?:delete|remove|verwijder)\\s+(?:the\\s+)?(\\d{1,3})\\s+(?:messages?|berichten)'),
  rule('delete-messages', '(?:delete|remove|verwijder)\\s+(?:the\\s+)?messages?\\s+(\\d{1,3})'),
  rule('delete-role', '(?:delete|remove)\\s+(?:the\\s+)?role\\s+(.+)'),
  rule('delete-role', '(?:verwijder)\\s+(?:de\\s+)?rol\\s+(.+)'),
  rule('delete-message', '(?:delete|remove)\\s+(?:the\\s+)?message\\s+(.+)'),
  rule('delete-message', '(?:verwijder)\\s+(?:het\\s+)?bericht\\s+(.+)'),
];

function parse(text) {
  const clean = String(text || '')
    .replace(/<@!?\d+>/g, '')
    .trim();
  for (const { action, re } of ACTIONS) {
    const match = re.exec(clean);
    if (match) return { action, target: String(match[1] || '').trim(), text: clean };
  }
  return null;
}

function findRole(guild, query) {
  const cleaned = String(query || '').replace(/[<@&>]/g, '').trim();
  if (!cleaned) return null;
  return (
    guild.roles.cache.get(cleaned) ||
    guild.roles.cache.find((role) => role.name.toLowerCase() === cleaned.toLowerCase()) ||
    guild.roles.cache.find((role) => role.name.toLowerCase().includes(cleaned.toLowerCase())) ||
    null
  );
}

function messageTarget(message, target) {
  const value = String(target || '').trim();
  if (/^(this|dit|deze)$/i.test(value) && message.reference?.messageId) {
    return { channelId: message.channelId, messageId: message.reference.messageId };
  }
  const link = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i.exec(value);
  if (link) {
    if (String(link[1]) !== String(message.guildId)) return null;
    return { channelId: link[2], messageId: link[3] };
  }
  const id = value.replace(/[^0-9]/g, '');
  if (id.length < 15) return null;
  return { channelId: message.channelId, messageId: id };
}

function confirmRow(nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`owner-confirm:${nonce}`)
      .setLabel('Yes, delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`owner-cancel:${nonce}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

function confirmEmbed(item) {
  const descriptions = {
    ticket:
      'This closes the ticket, stores the transcript and deletes the channel after the configured delay.',
    role: `This permanently deletes the role **${item.label}** from the server.`,
    messages: `This permanently deletes the last **${item.count}** messages in this channel.`,
    message: `This permanently deletes a message in <#${item.channelId}>.`,
  };
  return new EmbedBuilder()
    .setTitle('🗑️ Confirm deletion')
    .setColor('#FF4D5E')
    .setDescription(`${descriptions[item.kind]}\n\nOnly the owner can confirm this.`)
    .setFooter({ text: 'Champ AI · owner action' });
}

async function prompt(message, action) {
  if (!isOwner(message.author)) return false;
  const guild = message.guild;
  const base = {
    userId: message.author.id,
    guildId: guild.id,
    channelId: message.channelId,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  };

  if (action.action === 'delete-ticket') {
    return confirm(message, { ...base, kind: 'ticket' });
  }

  if (action.action === 'delete-role') {
    const role = findRole(guild, action.target);
    if (!role) {
      await message.reply(`❌ I can't find a role called **${action.target}**.`).catch(() => {});
      return true;
    }
    const me = guild.members.me;
    if (role.id === guild.id) {
      await message.reply('❌ I cannot delete the @everyone role.').catch(() => {});
      return true;
    }
    if (role.managed) {
      await message.reply('❌ That role is managed by an integration and cannot be deleted.').catch(() => {});
      return true;
    }
    if (me && role.position >= me.roles.highest.position) {
      await message.reply('❌ That role is above my highest role, so I cannot delete it.').catch(() => {});
      return true;
    }
    return confirm(message, { ...base, kind: 'role', roleId: role.id, label: role.name });
  }

  if (action.action === 'delete-messages') {
    const count = Math.max(1, Math.min(100, Number(action.target) || 0));
    return confirm(message, { ...base, kind: 'messages', count });
  }

  const target = messageTarget(message, action.target);
  if (!target) {
    await message.reply('❌ Send a message link or id, or reply to the message with `delete this message`.').catch(() => {});
    return true;
  }
  const channel = await message.client.channels.fetch(target.channelId).catch(() => null);
  const targetMessage = await channel?.messages?.fetch(target.messageId).catch(() => null);
  if (!targetMessage) {
    await message.reply('❌ I cannot find that message in this server.').catch(() => {});
    return true;
  }
  return confirm(message, { ...base, kind: 'message', channelId: target.channelId, messageId: target.messageId });
}

async function confirm(message, item) {
  const nonce = crypto.randomBytes(6).toString('hex');
  pending.set(nonce, item);
  await message
    .reply({
      embeds: [confirmEmbed(item)],
      components: [confirmRow(nonce)],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  return true;
}

async function handleButton(interaction) {
  const [, action, nonce] = String(interaction.customId).split(':');
  if (!isOwner(interaction.user)) {
    return interaction.reply({ content: '❌ Only the owner can do that.', ephemeral: true }).catch(() => {});
  }
  const item = pending.get(nonce);
  if (!item || item.expiresAt < Date.now()) {
    pending.delete(nonce);
    return interaction
      .reply({ content: '⌛ That confirmation expired. Ask me again.', ephemeral: true })
      .catch(() => {});
  }
  if (String(item.userId) !== String(interaction.user.id) || String(item.guildId) !== String(interaction.guildId)) {
    return interaction.reply({ content: '❌ This confirmation belongs to someone else.', ephemeral: true }).catch(() => {});
  }
  pending.delete(nonce);

  if (action === 'owner-cancel') {
    return interaction
      .update({ embeds: [new EmbedBuilder().setTitle('Cancelled').setColor('#6B7280').setDescription('Nothing was deleted.')], components: [] })
      .catch(() => {});
  }

  try {
    if (item.kind === 'ticket') {
      await interaction.update({
        embeds: [new EmbedBuilder().setTitle('🗑️ Deleting ticket').setColor('#FF4D5E').setDescription('Transcript is being saved.')],
        components: [],
      });
      const { closeTicketChannel } = require('../handlers/ticketInteractions');
      await closeTicketChannel(interaction.channel, getTicketConfig(), {
        closerTag: interaction.user.tag,
        closerId: interaction.user.id,
        reason: 'Deleted by the owner through Champ AI',
      });
      return;
    }

    if (item.kind === 'role') {
      const role = interaction.guild.roles.cache.get(item.roleId);
      if (!role) throw new Error('That role is already gone.');
      await role.delete('Deleted by the owner through Champ AI');
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('🗑️ Role deleted').setColor('#22C55E').setDescription(`**${role.name}** is gone.`)],
        components: [],
      });
    }

    if (item.kind === 'messages') {
      const fetched = await interaction.channel.messages.fetch({ limit: item.count });
      const deleted = await interaction.channel.bulkDelete(fetched, true).catch(async () => {
        let count = 0;
        for (const message of fetched.values()) {
          if (await message.delete().then(() => true).catch(() => false)) count += 1;
        }
        return count;
      });
      const count = typeof deleted === 'number' ? deleted : deleted.size;
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('🗑️ Messages deleted').setColor('#22C55E').setDescription(`Removed **${count}** message(s).`)],
        components: [],
      });
    }

    const channel = await interaction.client.channels.fetch(item.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(item.messageId).catch(() => null);
    if (!message) throw new Error('That message is already gone.');
    await message.delete();
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('🗑️ Message deleted').setColor('#22C55E').setDescription('The message is gone.')],
      components: [],
    });
  } catch (err) {
    log.warn('ai', `owner action failed: ${err.message}`);
    const payload = { content: `❌ ${err.message}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
}

module.exports = {
  OWNER_USERNAMES,
  isOwner,
  isOwnerGuild,
  parse,
  prompt,
  handleButton,
  __internal: { findRole, messageTarget },
};
