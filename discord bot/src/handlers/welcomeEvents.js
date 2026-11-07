const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getWelcomeConfig } = require('../utils/welcomeSettings');
const { buildWelcomeMessage, buildGoodbyeMessage } = require('../utils/welcome');

function linkRow(links = []) {
  if (!links.length) return null;
  return new ActionRowBuilder().addComponents(
    links.map((link) =>
      new ButtonBuilder().setLabel(link.label).setURL(link.url).setStyle(ButtonStyle.Link)
    )
  );
}

function toEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle(data.title || null)
    .setDescription(data.description || null)
    .setColor(data.color || '#FFC93C');
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.image) embed.setImage(data.image);
  if (data.footer) embed.setFooter({ text: data.footer });
  return embed;
}

async function resolveChannel(guild, channelId) {
  if (!guild || !channelId || String(channelId).includes('_ID')) return null;
  try {
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId));
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

async function addAutoRoles(member, config) {
  const me = member.guild.members.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.error('[welcome] Manage Roles is missing, so auto roles are skipped.');
    return;
  }
  for (const roleId of config.autoRoles || []) {
    if (!roleId || roleId === member.guild.id) continue;
    await member.roles.add(roleId).catch((err) => {
      console.error(`[welcome] could not add role ${roleId}:`, err.message);
    });
  }
}

// Joins: optional auto roles, the welcome embed in the configured channel, and an optional DM.
async function onGuildMemberAdd(member) {
  const config = getWelcomeConfig();
  if (!config.enabled || !member?.guild) return;

  await addAutoRoles(member, config);

  const payload = buildWelcomeMessage(member, config, {
    memberCount: member.guild.memberCount,
  });
  const channel = await resolveChannel(member.guild, config.channelId);
  const row = linkRow(payload.links);
  if (channel) {
    await channel
      .send({
        content: payload.content || undefined,
        embeds: payload.embeds.map(toEmbed),
        components: row ? [row] : [],
        allowedMentions: { users: [member.id] },
      })
      .catch((err) => console.error('[welcome] could not post the welcome message:', err.message));
  } else {
    console.error('[welcome] no welcome channel configured (use /welcome channel).');
  }

  if (payload.dm) {
    await member.send(payload.dm).catch(() => {
      /* DMs closed; the channel message already welcomed them. */
    });
  }
}

async function onGuildMemberRemove(member) {
  const config = getWelcomeConfig();
  if (!config.enabled || !member?.guild || config.goodbye?.enabled === false) return;

  const channel = await resolveChannel(member.guild, config.goodbyeChannelId || config.channelId);
  if (!channel) return;

  const payload = buildGoodbyeMessage(member, config, {
    memberCount: member.guild.memberCount,
  });
  await channel
    .send({ embeds: payload.embeds.map(toEmbed), allowedMentions: { parse: [] } })
    .catch((err) => console.error('[welcome] could not post the goodbye message:', err.message));
}

module.exports = { onGuildMemberAdd, onGuildMemberRemove, toEmbed, linkRow };
