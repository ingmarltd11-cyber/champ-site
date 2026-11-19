const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');

function isEphemeral(interaction) {
  return Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
}

function isComponent(interaction) {
  return Boolean(
    interaction.isButton?.() ||
      interaction.isStringSelectMenu?.() ||
      interaction.isChannelSelectMenu?.() ||
      interaction.isRoleSelectMenu?.() ||
      interaction.isUserSelectMenu?.() ||
      interaction.isMentionableSelectMenu?.()
  );
}

// Section screens live in ephemeral messages. A click on one should edit that message; a click
// on the public control panel should open a fresh ephemeral screen instead of editing it.
async function view(interaction, payload) {
  const clean = { ...payload };
  delete clean.ephemeral;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(clean).catch(() => {});
  }
  if (isEphemeral(interaction) && isComponent(interaction)) {
    try {
      return await interaction.update(clean);
    } catch {
      /* fall through to a fresh reply */
    }
  }
  return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
}

function staff(member, guild) {
  return isStaffMember(member, guild, getTicketConfig());
}

function requireStaff(interaction) {
  if (staff(interaction.member, interaction.guild)) return true;
  interaction
    .reply({ content: '❌ Only Champ staff can use this action.', ephemeral: true })
    .catch(() => {});
  return false;
}

function isAdmin(member) {
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function clip(value, max = 100) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { isEphemeral, isComponent, view, staff, requireStaff, isAdmin, clip };
