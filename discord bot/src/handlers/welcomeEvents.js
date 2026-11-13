const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getWelcomeConfig, updateWelcomeConfig } = require('../utils/welcomeSettings');
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

// A configured id wins. Otherwise use the server's system channel, then a channel named
// welcome/welkom. `/welcome setup` can create one when the server has none.
async function findWelcomeChannel(guild, config = {}, { create = false } = {}) {
  const configured = await resolveChannel(guild, config.channelId);
  if (configured) return configured;

  const system = guild?.systemChannel;
  if (system?.isTextBased?.()) return system;

  const named = guild?.channels?.cache?.find?.(
    (channel) => channel?.isTextBased?.() && /(^|[-_])welcome|welkom/i.test(channel.name || '')
  );
  if (named) return named;

  if (!create) return null;
  const me = guild?.members?.me;
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return null;
  try {
    return await guild.channels.create({
      name: 'welcome',
      type: ChannelType.GuildText,
      reason: 'Champ welcome setup',
    });
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
  const channel = await findWelcomeChannel(member.guild, config, { create: true });
  if (channel && !config.channelId) {
    await updateWelcomeConfig({ channelId: channel.id }).catch(() => {});
  }
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

  const channel = config.goodbyeChannelId
    ? await resolveChannel(member.guild, config.goodbyeChannelId)
    : await findWelcomeChannel(member.guild, config);
  if (!channel) return;

  const payload = buildGoodbyeMessage(member, config, {
    memberCount: member.guild.memberCount,
  });
  await channel
    .send({ embeds: payload.embeds.map(toEmbed), allowedMentions: { parse: [] } })
    .catch((err) => console.error('[welcome] could not post the goodbye message:', err.message));
}

module.exports = { onGuildMemberAdd, onGuildMemberRemove, toEmbed, linkRow, findWelcomeChannel };
