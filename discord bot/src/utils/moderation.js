const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('./permissions');
const { truncate } = require('./format');

// Moderation helpers shared by /mod, /announce and /rules. Everything here is best-effort:
// a missing mod-log channel or a closed DM must never fail the action itself.

const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

// "10m", "2h", "1d", "45s" and a bare number (minutes). Discord caps timeouts at 28 days.
function parseDuration(input) {
  const match = /^(\d{1,5})\s*(s|m|h|d)?$/i.exec(String(input ?? '').trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ms = amount * UNITS[unit];
  if (ms > 28 * UNITS.d) return null;
  return ms;
}

function formatDuration(ms) {
  if (ms % UNITS.d === 0) return `${ms / UNITS.d}d`;
  if (ms % UNITS.h === 0) return `${ms / UNITS.h}h`;
  if (ms % UNITS.m === 0) return `${ms / UNITS.m}m`;
  return `${Math.round(ms / 1000)}s`;
}

// Staff = Manage Server, a configured staff role, or the support role. One gate for every
// command, so a role added in config/tickets.json works everywhere at once.
function requireStaff(interaction) {
  const config = getTicketConfig();
  if (isStaffMember(interaction.member, interaction.guild, config)) return true;
  interaction
    .reply({ content: '❌ Only Champ staff can use this command.', ephemeral: true })
    .catch(() => {});
  return false;
}

function botCan(guild, ...flags) {
  const me = guild?.members?.me;
  if (!me) return false;
  return flags.every((flag) => me.permissions.has(flag));
}

async function logAction(client, { title, color = '#2EC4B6', moderator, target, reason, fields = [] }) {
  const channelId = process.env.MOD_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp()
    .addFields(
      { name: 'Moderator', value: `${moderator} (${moderator.tag || moderator.id})`, inline: true },
      ...(target ? [{ name: 'Member', value: `${target} (${target.tag || target.id})`, inline: true }] : []),
      { name: 'Reason', value: truncate(reason || 'No reason given', 1000) },
      ...fields
    )
    .setFooter({ text: 'Champ Client · moderation log' });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function dmTarget(user, embed) {
  if (!user) return false;
  return Boolean(await user.send({ embeds: [embed] }).catch(() => false));
}

// A moderator may not act on someone whose highest role is at or above their own, and nobody
// can act on the server owner. The bot itself is exempt from the first rule.
function canActOn(interaction, member) {
  const guild = interaction.guild;
  if (!member || !guild) return 'That member is not in this server.';
  if (member.id === interaction.user.id) return 'You cannot use this on yourself.';
  if (member.id === interaction.client.user.id) return 'I am not doing that to myself.';
  if (guild.ownerId === member.id) return 'The server owner cannot be moderated.';
  if (guild.ownerId === interaction.user.id) return null;

  const actor = interaction.member;
  const actorTop = actor?.roles?.highest?.position ?? 0;
  const targetTop = member.roles?.highest?.position ?? 0;
  if (!actor?.permissions?.has(PermissionFlagsBits.Administrator) && targetTop >= actorTop) {
    return 'That member has an equal or higher role than you.';
  }
  return null;
}

module.exports = {
  parseDuration,
  formatDuration,
  requireStaff,
  botCan,
  logAction,
  dmTarget,
  canActOn,
};
