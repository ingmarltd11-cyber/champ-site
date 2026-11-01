const { PermissionFlagsBits } = require('discord.js');

// Support roles can be configured per ticket type (role id), globally (supportRoleId) or by
// name. Staff members are anyone with Manage Server, one of staffRoleIds, or the support role.
function resolveSupportRole(guild, type, config) {
  if (!guild) return null;
  const byId = type?.supportRoleId || config?.settings?.supportRoleId;
  if (byId && !String(byId).includes('_ID')) {
    const role = guild.roles.cache.get(byId);
    if (role) return role;
  }
  const name = config?.settings?.defaultSupportRoleName;
  if (name) {
    return guild.roles.cache.find((r) => r.name.toLowerCase() === String(name).toLowerCase()) || null;
  }
  return null;
}

function isStaffMember(member, guild, config) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;

  const ids = new Set([
    ...(config?.settings?.staffRoleIds || []),
    config?.settings?.supportRoleId,
    ...(config?.types || []).map((t) => t.supportRoleId),
  ]);
  for (const id of ids) {
    if (id && member.roles?.cache?.has(id)) return true;
  }

  const names = new Set(
    [config?.settings?.defaultSupportRoleName, ...(config?.settings?.staffRoleNames || [])]
      .filter(Boolean)
      .map((n) => String(n).toLowerCase())
  );
  return member.roles?.cache?.some((role) => names.has(role.name.toLowerCase())) ?? false;
}

module.exports = { resolveSupportRole, isStaffMember };
