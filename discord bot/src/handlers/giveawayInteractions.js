const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const giveawayStore = require('../utils/giveawayStore');
const { getGiveawayConfig } = require('../config/loadConfig');
const { pickWinners, giveawayEmbedData, isTooNew } = require('../utils/giveaway');

function isManager(member, config, giveaway) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (giveaway?.hostId && member.id === giveaway.hostId) return true;
  return (config.managerRoleIds || []).some((id) => member.roles?.cache?.has(id));
}

function embed(data) {
  const e = new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.description)
    .setColor(data.color);
  if (data.fields?.length) e.addFields(data.fields);
  if (data.footer) e.setFooter({ text: data.footer });
  if (data.timestamp) e.setTimestamp();
  return e;
}

function entryRow(giveaway, count) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveaway.id}`)
      .setLabel(count ? `Enter · ${count}` : 'Enter')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
  );
}

function endedRow(giveaway) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:reroll:${giveaway.id}`)
      .setLabel('Reroll')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function refreshMessage(client, giveaway, { ended = false } = {}) {
  if (!giveaway.channelId || !giveaway.messageId) return;
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(giveaway.messageId);
    await message.edit({
      embeds: [
        embed(
          giveawayEmbedData(giveaway, {
            entriesCount: giveaway.entries.length,
            ended,
            winnerIds: giveaway.winnerIds,
            endedBy: giveaway.endedBy,
          })
        ),
      ],
      components: ended ? [endedRow(giveaway)] : [entryRow(giveaway, giveaway.entries.length)],
    });
  } catch (err) {
    console.error('[giveaway] could not refresh the message:', err.message);
  }
}

async function dmWinners(client, giveaway, winnerIds) {
  const config = getGiveawayConfig();
  if (!config.dmWinners) return;
  const guildName = client.guilds?.cache?.get(giveaway.guildId)?.name || 'the server';
  for (const id of winnerIds) {
    try {
      const user = await client.users.fetch(id);
      await user.send(`🎉 You won **${giveaway.prize}** in **${guildName}**!`);
    } catch {
      /* DMs closed: the channel announcement is the source of truth. */
    }
  }
}

async function endGiveaway(client, giveaway, { endedBy = null } = {}) {
  const fresh = await giveawayStore.getGiveaway(giveaway.id);
  if (!fresh) return { giveaway: null, winners: [], alreadyEnded: false };
  if (fresh.ended) return { giveaway: fresh, winners: fresh.winnerIds, alreadyEnded: true };

  const winners = pickWinners(fresh.entries, fresh.winners);
  const updated = await giveawayStore.markEnded(fresh.id, {
    winnerIds: winners,
    endedBy,
  });

  await refreshMessage(client, updated, { ended: true });

  if (updated.channelId) {
    try {
      const channel = await client.channels.fetch(updated.channelId);
      if (channel?.isTextBased()) {
        const line = winners.length
          ? `🏆 ${winners.map((id) => `<@${id}>`).join(', ')} won **${updated.prize}** with ${updated.entries.length} ${updated.entries.length === 1 ? 'entry' : 'entries'}!`
          : `😔 **${updated.prize}** ended without any entries.`;
        await channel.send(line);
      }
    } catch (err) {
      console.error('[giveaway] could not announce the winners:', err.message);
    }
  }

  await dmWinners(client, updated, winners);
  return { giveaway: updated, winners, alreadyEnded: false };
}

async function rerollGiveaway(client, giveaway, { count = 1, by = null } = {}) {
  const fresh = await giveawayStore.getGiveaway(giveaway.id);
  if (!fresh) return { giveaway: null, winners: [] };
  if (!fresh.ended) return { giveaway: fresh, winners: [], notEnded: true };

  const previous = new Set(fresh.winnerIds);
  let pool = fresh.entries.filter((id) => !previous.has(id));
  if (!pool.length) pool = [...fresh.entries]; // everyone already won once: start over
  const winners = pickWinners(pool, count);
  const updated = await giveawayStore.updateGiveaway(fresh.id, {
    winnerIds: [...new Set([...fresh.winnerIds, ...winners])],
    endedBy: by || fresh.endedBy,
  });

  await refreshMessage(client, updated, { ended: true });
  if (updated.channelId) {
    try {
      const channel = await client.channels.fetch(updated.channelId);
      if (channel?.isTextBased()) {
        await channel.send(
          winners.length
            ? `🔁 Reroll: ${winners.map((id) => `<@${id}>`).join(', ')} win **${updated.prize}**!`
            : `🔁 Reroll for **${updated.prize}** had no eligible entries.`
        );
      }
    } catch (err) {
      console.error('[giveaway] could not announce the reroll:', err.message);
    }
  }

  await dmWinners(client, updated, winners);
  return { giveaway: updated, winners };
}

async function handleGiveawayButton(interaction) {
  const [namespace, action, id] = interaction.customId.split(':');
  if (namespace !== 'giveaway') return false;

  const config = getGiveawayConfig();
  const giveaway = await giveawayStore.getGiveaway(id);
  if (!giveaway) {
    await interaction.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
    return true;
  }
  if (giveaway.guildId && interaction.guildId && giveaway.guildId !== interaction.guildId) {
    await interaction.reply({ content: 'This giveaway belongs to another server.', ephemeral: true });
    return true;
  }

  if (action === 'enter') {
    if (giveaway.ended) {
      await interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
      return true;
    }
    if (giveaway.requiredRoleId && !interaction.member?.roles?.cache?.has(giveaway.requiredRoleId)) {
      await interaction.reply({
        content: `You need <@&${giveaway.requiredRoleId}> to enter this giveaway.`,
        ephemeral: true,
      });
      return true;
    }
    if (isTooNew(interaction.user.createdAt, giveaway.minAccountAgeDays)) {
      await interaction.reply({
        content: `Your account must be at least ${giveaway.minAccountAgeDays} day(s) old to enter.`,
        ephemeral: true,
      });
      return true;
    }

    const { added, total } = await giveawayStore.addEntry(id, interaction.user.id);
    await interaction.reply({
      content: added
        ? `🎉 You are in! **${total}** ${total === 1 ? 'entry' : 'entries'} so far.`
        : 'You are already entered in this giveaway.',
      ephemeral: true,
    });
    const fresh = await giveawayStore.getGiveaway(id);
    if (fresh) await refreshMessage(interaction.client, fresh);
    return true;
  }

  if (action === 'entries') {
    await interaction.reply({
      content: `**${giveaway.entries.length}** ${giveaway.entries.length === 1 ? 'entry' : 'entries'} for **${giveaway.prize}**.`,
      ephemeral: true,
    });
    return true;
  }

  if (action === 'end' || action === 'reroll') {
    if (!isManager(interaction.member, config, giveaway)) {
      await interaction.reply({
        content: 'Only the giveaway host or staff can do that.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      content: action === 'end' ? 'Ending the giveaway…' : 'Rerolling the winner…',
      ephemeral: true,
    }).catch(() => {});

    if (action === 'end') {
      await endGiveaway(interaction.client, giveaway, { endedBy: interaction.user.id });
    } else {
      await rerollGiveaway(interaction.client, giveaway, { by: interaction.user.id });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleGiveawayButton,
  endGiveaway,
  rerollGiveaway,
  refreshMessage,
  embed,
  entryRow,
  endedRow,
  isManager,
};
