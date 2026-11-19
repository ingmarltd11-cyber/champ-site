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
const { getPaymentConfig, getTicketConfig } = require('../config/loadConfig');
const { isStaffMember } = require('../utils/permissions');
const { siteUrl, truncate } = require('../utils/format');
const payments = require('../payments/paymentClient');
const { buildId, parseId } = require('../core/ids');
const { log } = require('../utils/logger');

const PLAN_ORDER = ['weekly', 'monthly', 'lifetime'];

function plans(config) {
  return PLAN_ORDER.map((id) => ({ id, ...(config.plans?.[id] || {}) }));
}

function planOf(config, id) {
  return plans(config).find((plan) => plan.id === id) || { id, label: id, price: '' };
}

function euro(order) {
  const value = Number(order?.amount_eur);
  return Number.isFinite(value) ? `€${value.toFixed(2)}` : '—';
}

function methodLabel(method) {
  return method === 'crypto' ? 'Crypto' : method === 'donut' ? 'DonutSMP money' : method === 'giftcard' ? 'Gift card' : 'not chosen';
}

function statusMeta(status) {
  switch (status) {
    case 'paid':
      return { color: '#22C55E', label: '✅ Paid', line: 'Payment confirmed. Your license is active.' };
    case 'review':
      return { color: '#F59E0B', label: '🕓 In review', line: 'A staff member is checking this payment.' };
    case 'rejected':
      return { color: '#EF4444', label: '❌ Rejected', line: 'This payment was rejected. Start a new checkout.' };
    case 'expired':
      return { color: '#6B7280', label: '⌛ Expired', line: 'This order expired. Start a new checkout.' };
    default:
      return { color: '#FFC93C', label: '⏳ Waiting', line: 'Waiting for your payment.' };
  }
}

function detailLines(order) {
  const lines = [];
  if (order.method === 'crypto' && order.crypto) {
    lines.push(`**Send exactly** \`${order.crypto.amount || '—'}\` **${order.crypto.coin || 'BTC'}**`);
    lines.push(`Address:\n\`\`\`\n${order.crypto.address || 'not configured'}\n\`\`\``);
    if (order.crypto.txid) lines.push(`Submitted txid: \`${order.crypto.txid}\``);
    else lines.push('After sending, press **I paid — submit txid** and paste the transaction hash.');
  }
  if (order.method === 'donut' && order.donut) {
    lines.push(`**Pay ${order.donut.amount || 0} Donut money** to **${order.donut.bot || 'the shop account'}**.`);
    lines.push(`Your DonutSMP username: **${order.donut.username || '—'}**`);
    lines.push(
      order.donut.mode === 'bot'
        ? 'The payment bot checks DonutSMP automatically; press **Refresh** in a moment.'
        : 'Staff will check the payment. Press **Refresh** to see the status.'
    );
  }
  if (order.method === 'giftcard' && order.giftcard) {
    lines.push(`**${order.giftcard.brand || 'Gift card'}** worth **€${((order.giftcard.value_cents || 0) / 100).toFixed(2)}**`);
    if (order.giftcard.last4) lines.push(`Card ending in \`${order.giftcard.last4}\``);
    if (order.giftcard.note) lines.push(order.giftcard.note);
  }
  if (!lines.length) lines.push('Choose a payment method to see the instructions.');
  return lines;
}

function orderEmbed(order, license = null) {
  const meta = statusMeta(order.status);
  const embed = new EmbedBuilder()
    .setTitle(`${meta.label} · ${planOf(getPaymentConfig(), order.plan_type).label || order.plan_type}`)
    .setColor(meta.color)
    .setDescription(
      `${meta.line}\n\n${detailLines(order).join('\n')}` +
        (order.admin_note ? `\n\n**Staff note:** ${truncate(order.admin_note, 500)}` : '')
    )
    .addFields(
      { name: 'Plan', value: order.plan_type || '—', inline: true },
      { name: 'Amount', value: euro(order), inline: true },
      { name: 'Method', value: methodLabel(order.method), inline: true },
      { name: 'Order', value: `\`${order.uid}\``, inline: true },
      {
        name: 'Created',
        value: order.created_at ? new Date(order.created_at).toLocaleString('en-GB') : '—',
        inline: true,
      },
      {
        name: 'Expires',
        value: order.expires_at ? new Date(order.expires_at).toLocaleString('en-GB') : '—',
        inline: true,
      }
    );

  if (license?.license_key) {
    embed.addFields({
      name: '🔑 Your license key',
      value: `\`\`\`\n${license.license_key}\n\`\`\``,
    });
    if (license.expires_at) {
      embed.addFields({ name: 'Active until', value: new Date(license.expires_at).toLocaleString('en-GB') });
    }
  } else if (order.status === 'paid') {
    embed.addFields({ name: '🔑 License', value: 'Active on your linked account. Open the dashboard to download.' });
  }

  return embed.setFooter({ text: `Champ Client · order ${order.uid}` }).setTimestamp();
}

function orderComponents(order, { back = true } = {}) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'status', order.uid))
      .setLabel('Refresh status')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  if (order.method === 'crypto' && order.status !== 'paid' && !order.crypto?.txid) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('pay', 'tx', order.uid))
        .setLabel('I paid — submit txid')
        .setEmoji('🧾')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (back) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('pay', 'orders'))
        .setLabel('My orders')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const components = [row];
  if (order.status === 'paid') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open dashboard')
          .setURL(`${siteUrl()}/dashboard.html`)
          .setStyle(ButtonStyle.Link)
      )
    );
  }
  return components;
}

function accountHint() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Link Discord on the dashboard')
      .setURL(`${siteUrl()}/dashboard.html`)
      .setStyle(ButtonStyle.Link)
  );
}

async function replyError(interaction, err, { deferred = false } = {}) {
  const linkedAccountError = /link your discord/i.test(String(err?.message || ''));
  const linkRow = linkedAccountError ? [accountHint()] : [];
  const content = linkedAccountError
    ? `🔗 ${err.message}\n\nOpen the dashboard, choose **Discord → Link Discord account**, then run \`/link code:<code>\` here.`
    : `❌ ${err.message || 'The checkout is unavailable right now.'}`;
  const payload = { content, components: linkRow, ephemeral: true };
  if (deferred || interaction.deferred || interaction.replied) {
    return interaction.editReply(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}

async function showPlans(interaction, { update = false } = {}) {
  const config = getPaymentConfig();
  const embed = new EmbedBuilder()
    .setTitle('💳 Buy Champ')
    .setDescription('Choose a plan. You can pay with crypto, DonutSMP money or a gift card, all inside Discord.')
    .setColor(config.color || '#FFC93C')
    .addFields(
      ...plans(config).map((plan) => ({
        name: `${plan.label} · ${plan.price || ''}`.trim(),
        value: plan.description || (plan.days ? `${plan.days} days` : 'One payment'),
        inline: true,
      }))
    )
    .setFooter({ text: 'The license is added to your linked account when the payment clears.' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId('pay', 'plan'))
    .setPlaceholder('Choose a plan...')
    .addOptions(
      plans(config).map((plan) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${plan.label} · ${plan.price || ''}`.slice(0, 100))
          .setValue(plan.id)
          .setDescription(String(plan.description || '').slice(0, 100) || undefined)
      )
    );

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('pay', 'orders'))
          .setLabel('My orders')
          .setEmoji('🧾')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('pay', 'how'))
          .setLabel('How it works')
          .setEmoji('❓')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    ephemeral: true,
  };

  if (update) return interaction.update(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function showMethods(interaction, planId, { update = false } = {}) {
  const config = getPaymentConfig();
  const plan = planOf(config, planId);
  if (!interaction.deferred && !interaction.replied) {
    if (update && typeof interaction.deferUpdate === 'function') await interaction.deferUpdate().catch(() => {});
    else await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  let data = null;
  let error = null;
  try {
    data = await payments.methods();
  } catch (err) {
    error = err;
  }

  const enabled = data?.methods || {};
  const embed = new EmbedBuilder()
    .setTitle(`💳 ${plan.label} · ${plan.price || ''}`)
    .setColor(config.color || '#FFC93C')
    .setDescription(
      error
        ? `I could not reach the Champ checkout: ${error.message}\n\nYou can still buy on the website.`
        : 'Pick how you want to pay. Your order is created on the Champ site and shown here; the license lands on your linked account.'
    )
    .addFields(
      { name: 'Plan', value: `${plan.label}${plan.days ? ` · ${plan.days} days` : ''}`, inline: true },
      { name: 'Price', value: plan.price || 'shown at checkout', inline: true },
      {
        name: 'Your account',
        value: 'Discord must be linked on the dashboard',
        inline: false,
      }
    )
    .setFooter({ text: 'Crypto, DonutSMP and gift cards are checked before the license unlocks.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'method', planId, 'crypto'))
      .setLabel(`Crypto${data?.crypto_coin ? ` (${data.crypto_coin})` : ''}`)
      .setEmoji('₿')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(error) || enabled.crypto === false),
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'method', planId, 'donut'))
      .setLabel('DonutSMP money')
      .setEmoji('🍩')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(error) || enabled.donut === false),
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'method', planId, 'giftcard'))
      .setLabel('Gift card')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(error) || enabled.giftcard === false)
  );

  const components = [row];
  const second = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'plans'))
      .setLabel('Other plans')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('pay', 'orders'))
      .setLabel('My orders')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );
  if (config.showWebCheckout !== false) {
    second.addComponents(
      new ButtonBuilder()
        .setLabel('Buy on the website')
        .setURL(`${siteUrl()}/index.html#pricing`)
        .setStyle(ButtonStyle.Link)
    );
  }
  components.push(second);

  return interaction.editReply({ embeds: [embed], components }).catch(() => {});
}

async function createWithMethod(interaction, planId, method, extra = {}) {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  try {
    const data = await payments.createCheckout({
      discordId: interaction.user.id,
      plan: planId,
      method,
      ...extra,
    });

    if (data.active) {
      const embed = new EmbedBuilder()
        .setTitle('✅ You already have this plan')
        .setColor('#22C55E')
        .setDescription('This license is already active on your linked account. Open the dashboard to download the client.')
        .addFields(
          { name: 'Plan', value: planId, inline: true },
          { name: 'Account', value: 'linked', inline: true }
        );
      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Open dashboard')
              .setURL(`${siteUrl()}/dashboard.html`)
              .setStyle(ButtonStyle.Link)
          ),
        ],
      });
    }

    if (!data.order) {
      return interaction.editReply({
        content: data.message || 'The checkout did not return an order. Try the website checkout.',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Website checkout')
              .setURL(`${siteUrl()}/index.html#pricing`)
              .setStyle(ButtonStyle.Link)
          ),
        ],
      });
    }

    return interaction.editReply({
      embeds: [orderEmbed(data.order, data.license)],
      components: orderComponents(data.order),
    });
  } catch (err) {
    log.warn('payments', `checkout failed for ${interaction.user.id}: ${err.message}`);
    return replyError(interaction, err, { deferred: true });
  }
}

async function showOrder(interaction, uid, { update = false } = {}) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      if (update && typeof interaction.deferUpdate === 'function') {
        await interaction.deferUpdate().catch(() => {});
      } else {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
      }
    }
    const data = await payments.getOrder(uid, interaction.user.id);
    return interaction.editReply({
      embeds: [orderEmbed(data.order, data.license)],
      components: orderComponents(data.order),
    });
  } catch (err) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content: `❌ ${err.message}` }).catch(() => {});
    }
    return replyError(interaction, err);
  }
}

async function myOrders(interaction, { update = false } = {}) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  try {
    const data = await payments.listMyOrders(interaction.user.id);
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if (!orders.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🧾 No orders yet')
            .setColor('#FFC93C')
            .setDescription('Start a checkout and your order will appear here with its live status.'),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildId('pay', 'plans'))
              .setLabel('Buy a plan')
              .setEmoji('💳')
              .setStyle(ButtonStyle.Primary)
          ),
        ],
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🧾 Your orders')
      .setColor('#2EC4B6')
      .setDescription('Pick an order to see its instructions, status and license.')
      .setFooter({ text: `${orders.length} order(s)` });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildId('pay', 'order'))
      .setPlaceholder('Open an order...')
      .addOptions(
        orders.slice(0, 25).map((order) => {
          const meta = statusMeta(order.status);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${meta.label} · ${planOf(getPaymentConfig(), order.plan_type).label}`.slice(0, 100))
            .setValue(order.uid)
            .setDescription(
              `${euro(order)} · ${new Date(order.created_at).toLocaleDateString('en-GB')}`.slice(0, 100)
            );
        })
      );

    return interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildId('pay', 'plans'))
            .setLabel('Buy another plan')
            .setEmoji('💳')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
}

async function howItWorks(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('❓ How Discord checkout works')
    .setColor('#2EC4B6')
    .setDescription(
      [
        '1. Link Discord to your Champ account on the dashboard (`/link code:<code>`).',
        '2. Choose a plan and a payment method in this panel.',
        '3. The bot creates the same order as the website and shows the exact amount/address or DonutSMP details.',
        '4. Submit the crypto txid, pay the Donut money, or enter the gift card code.',
        '5. The license is generated on your account the moment the payment clears; the key appears here and in your dashboard.',
      ].join('\n')
    )
    .setFooter({ text: 'The shop verifies every payment; the bot never writes a license itself.' });

  return interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('pay', 'plans'))
          .setLabel('Choose a plan')
          .setEmoji('💳')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setLabel('Dashboard')
          .setURL(`${siteUrl()}/dashboard.html`)
          .setStyle(ButtonStyle.Link)
      ),
    ],
    ephemeral: true,
  });
}

async function methodsInfo(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  let data;
  try {
    data = await payments.methods();
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
  const enabled = data.methods || {};
  const lines = [
    `${enabled.crypto ? '✅' : '⛔'} **Crypto** — ${data.crypto_coin || 'BTC'}${
      data.crypto_rate ? ` at €${Number(data.crypto_rate).toFixed(2)}/coin` : ''
    }`,
    `${enabled.donut ? '✅' : '⛔'} **DonutSMP money** — ${data.donut_mode === 'bot' ? 'automatic bot check' : 'staff review'}`,
    `${enabled.giftcard ? '✅' : '⛔'} **Gift cards** — ${(data.giftcard_brands || []).join(', ') || 'no brands configured'}`,
  ];
  if (data.giftcard_note) lines.push(`\n_${data.giftcard_note}_`);
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('💳 Payment methods')
        .setColor('#2EC4B6')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Availability comes live from the Champ site.' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('pay', 'plans'))
          .setLabel('Choose a plan')
          .setEmoji('💳')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  });
}

function requireStaff(interaction) {
  if (isStaffMember(interaction.member, interaction.guild, getTicketConfig())) return true;
  interaction.reply({ content: '❌ Only Champ staff can review payments.', ephemeral: true }).catch(() => {});
  return false;
}

async function staffQueue(interaction) {
  if (!requireStaff(interaction)) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  try {
    const data = await payments.staffQueue('all');
    const orders = (Array.isArray(data.orders) ? data.orders : []).filter((order) =>
      ['pending', 'review'].includes(order.status)
    );
    const embed = new EmbedBuilder()
      .setTitle('💳 Payment queue')
      .setColor('#FFC93C')
      .setDescription(
        orders.length
          ? 'Orders waiting for a payment or a staff check. Pick one to approve or reject it.'
          : 'No orders are waiting right now.'
      )
      .setFooter({ text: `${orders.length} waiting` });

    if (!orders.length) {
      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildId('pay', 'queue'))
              .setLabel('Refresh queue')
              .setEmoji('🔄')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setLabel('Open website admin')
              .setURL(`${siteUrl()}/admin.html`)
              .setStyle(ButtonStyle.Link)
          ),
        ],
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildId('pay', 'admin'))
      .setPlaceholder('Open an order...')
      .addOptions(
        orders.slice(0, 25).map((order) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${order.plan_type} · ${euro(order)} · ${order.status}`.slice(0, 100))
            .setValue(order.uid)
            .setDescription(`${order.method || 'no method'} · ${order.email || 'masked'}`.slice(0, 100))
        )
      );

    return interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildId('pay', 'queue'))
            .setLabel('Refresh queue')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setLabel('Open website admin')
            .setURL(`${siteUrl()}/admin.html`)
            .setStyle(ButtonStyle.Link)
        ),
      ],
    });
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
}

async function adminOrder(interaction, uid) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  try {
    const data = await payments.staffQueue('all');
    const order = (data.orders || []).find((item) => item.uid === uid);
    if (!order) {
      return interaction.editReply({ content: 'That order is no longer in the queue.' });
    }
    const meta = statusMeta(order.status);
    const embed = new EmbedBuilder()
      .setTitle(`💳 ${meta.label} · ${order.plan_type}`)
      .setColor(meta.color)
      .addFields(
        { name: 'Customer', value: order.email || 'hidden', inline: true },
        { name: 'Amount', value: euro(order), inline: true },
        { name: 'Method', value: methodLabel(order.method), inline: true },
        { name: 'Order', value: `\`${order.uid}\``, inline: true },
        {
          name: 'Created',
          value: order.created_at ? new Date(order.created_at).toLocaleString('en-GB') : '—',
          inline: true,
        },
        { name: 'Status', value: order.status, inline: true }
      )
      .setFooter({ text: 'Approving generates the license immediately and e-mails the customer.' });

    const components = [];
    if (['pending', 'review'].includes(order.status)) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildId('pay', 'approve', order.uid))
            .setLabel('Approve & deliver')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(buildId('pay', 'reject', order.uid))
            .setLabel('Reject')
            .setEmoji('⛔')
            .setStyle(ButtonStyle.Danger)
        )
      );
    }
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('pay', 'queue'))
          .setLabel('Back to queue')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setLabel('Open website admin')
          .setURL(`${siteUrl()}/admin.html`)
          .setStyle(ButtonStyle.Link)
      )
    );

    return interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
}

async function approveOrder(interaction, uid) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  try {
    const data = await payments.approve(uid, interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle('✅ Payment approved')
      .setColor('#22C55E')
      .setDescription('The license was generated and the customer was e-mailed.')
      .addFields(
        { name: 'Order', value: `\`${uid}\``, inline: true },
        { name: 'Plan', value: data.order?.plan_type || '—', inline: true }
      );
    if (data.license?.license_key) {
      embed.addFields({ name: 'License key', value: `\`\`\`\n${data.license.license_key}\n\`\`\`` });
    }
    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
}

async function rejectOrder(interaction, uid) {
  const modal = new ModalBuilder()
    .setCustomId(buildId('pay', 'reject-modal', uid))
    .setTitle('Reject this payment');
  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason shown to the customer')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

async function submitReject(interaction, uid) {
  if (!requireStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  try {
    const reason = interaction.fields.getTextInputValue('reason');
    await payments.reject(uid, reason, interaction.user.id);
    return interaction.editReply({ content: `⛔ Order \`${uid}\` was rejected and the reason was saved.` });
  } catch (err) {
    return replyError(interaction, err, { deferred: true });
  }
}

async function handlePayment(interaction) {
  const parts = parseId(interaction.customId);
  const [scope, action, arg1, arg2] = parts;

  if (scope === 'panel' && String(parts[2] || '').startsWith('pay-')) {
    const panelRef = parts[1];
    const sub = parts[2];
    if (sub === 'pay-plan' && interaction.isStringSelectMenu()) {
      return showMethods(interaction, interaction.values[0]);
    }
    if (sub === 'pay-orders') return myOrders(interaction);
    if (sub === 'pay-methods') return methodsInfo(interaction);
    if (sub === 'pay-help') return howItWorks(interaction);
    void panelRef;
    return false;
  }

  if (scope !== 'pay') return false;

  if (action === 'plans' && interaction.isButton()) return showPlans(interaction);
  if (action === 'plan' && interaction.isStringSelectMenu()) {
    return showMethods(interaction, interaction.values[0], { update: true });
  }
  if (action === 'method' && interaction.isButton()) {
    const planId = arg1;
    const method = arg2;
    if (method === 'donut') {
      const modal = new ModalBuilder()
        .setCustomId(buildId('pay', 'donut-modal', planId))
        .setTitle('DonutSMP payment');
      const username = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Your DonutSMP / Minecraft username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(16);
      modal.addComponents(new ActionRowBuilder().addComponents(username));
      return interaction.showModal(modal);
    }
    if (method === 'giftcard') {
      const modal = new ModalBuilder()
        .setCustomId(buildId('pay', 'gift-modal', planId))
        .setTitle('Gift card payment');
      const brand = new TextInputBuilder()
        .setCustomId('brand')
        .setLabel('Gift card brand')
        .setPlaceholder('Steam, Roblox, Apple, Google Play...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40);
      const value = new TextInputBuilder()
        .setCustomId('value')
        .setLabel('Card value in EUR')
        .setPlaceholder('10.00')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);
      const code = new TextInputBuilder()
        .setCustomId('code')
        .setLabel('Gift card code')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);
      modal.addComponents(
        new ActionRowBuilder().addComponents(brand),
        new ActionRowBuilder().addComponents(value),
        new ActionRowBuilder().addComponents(code)
      );
      return interaction.showModal(modal);
    }
    return createWithMethod(interaction, planId, method);
  }
  if (action === 'donut-modal' && interaction.isModalSubmit()) {
    return createWithMethod(interaction, arg1, 'donut', {
      donutUsername: interaction.fields.getTextInputValue('username').trim(),
    });
  }
  if (action === 'gift-modal' && interaction.isModalSubmit()) {
    return createWithMethod(interaction, arg1, 'giftcard', {
      giftCardBrand: interaction.fields.getTextInputValue('brand').trim(),
      giftCardValue: Number(interaction.fields.getTextInputValue('value')),
      giftCardCode: interaction.fields.getTextInputValue('code').trim(),
    });
  }
  if (action === 'orders' && interaction.isButton()) return myOrders(interaction);
  if (action === 'order' && interaction.isStringSelectMenu()) {
    return showOrder(interaction, interaction.values[0], { update: true });
  }
  if (action === 'status' && interaction.isButton()) {
    return showOrder(interaction, arg1, { update: true });
  }
  if (action === 'tx' && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(buildId('pay', 'tx-modal', arg1))
      .setTitle('Submit your transaction hash');
    const txid = new TextInputBuilder()
      .setCustomId('txid')
      .setLabel('Transaction hash (txid)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(16)
      .setMaxLength(128);
    modal.addComponents(new ActionRowBuilder().addComponents(txid));
    return interaction.showModal(modal);
  }
  if (action === 'tx-modal' && interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    try {
      const txid = interaction.fields.getTextInputValue('txid').trim();
      const data = await payments.submitCrypto(arg1, interaction.user.id, txid);
      return interaction.editReply({
        content: data.paid
          ? '✅ Payment confirmed. Your license is active on your account.'
          : data.message || 'Transaction received. The status will update when it confirms.',
        embeds: data.order ? [orderEmbed(data.order, data.license)] : [],
        components: data.order ? orderComponents(data.order) : [],
      });
    } catch (err) {
      return replyError(interaction, err, { deferred: true });
    }
  }
  if (action === 'how' && interaction.isButton()) return howItWorks(interaction);
  if (action === 'queue' && (interaction.isButton() || interaction.isStringSelectMenu())) {
    return staffQueue(interaction);
  }
  if (action === 'admin' && interaction.isStringSelectMenu()) {
    return adminOrder(interaction, interaction.values[0]);
  }
  if (action === 'approve' && interaction.isButton()) return approveOrder(interaction, arg1);
  if (action === 'reject' && interaction.isButton()) return rejectOrder(interaction, arg1);
  if (action === 'reject-modal' && interaction.isModalSubmit()) return submitReject(interaction, arg1);

  return false;
}

module.exports = {
  handlePayment,
  showPlans,
  showMethods,
  showOrder,
  myOrders,
  staffQueue,
  orderEmbed,
  statusMeta,
};
