const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getPaymentConfig } = require('../config/loadConfig');
const { siteUrl } = require('../utils/format');
const { buildId } = require('../core/ids');

function planEntries(config) {
  const plans = config.plans || {};
  return ['weekly', 'monthly', 'lifetime']
    .map((id) => ({ id, ...(plans[id] || {}) }))
    .filter((plan) => plan.id);
}

function build(panel) {
  const config = getPaymentConfig();
  const options = panel.options || {};
  const plans = planEntries(config);
  const enabled = options.enabled !== false && config.enabled !== false;

  const embed = new EmbedBuilder()
    .setTitle(options.title || config.title || '💳 Champ checkout')
    .setDescription(
      options.description ||
        config.description ||
        'Choose a plan to pay with crypto, DonutSMP money or a gift card.'
    )
    .setColor(options.color || config.color || '#FFC93C')
    .addFields(
      ...plans.map((plan) => ({
        name: `${plan.label || plan.id} · ${plan.price || ''}`.trim(),
        value: plan.description || (plan.days ? `${plan.days} days` : 'One payment'),
        inline: true,
      }))
    )
    .setFooter({ text: 'Champ Client · secure checkout' });

  if (!enabled) {
    embed.setDescription('Payments are temporarily closed in Discord. Use the website checkout instead.');
    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Open website checkout')
            .setURL(`${siteUrl()}/index.html#pricing`)
            .setStyle(ButtonStyle.Link)
        ),
      ],
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId('panel', panel.id, 'pay-plan'))
    .setPlaceholder('Choose a plan to buy...')
    .addOptions(
      plans.map((plan) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${plan.label || plan.id} · ${plan.price || ''}`.slice(0, 100))
          .setValue(plan.id)
          .setDescription(String(plan.description || '').slice(0, 100) || undefined)
          .setEmoji(plan.id === 'lifetime' ? '💎' : plan.id === 'monthly' ? '📅' : '🗓️')
      )
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'pay-orders'))
      .setLabel('My orders')
      .setEmoji('🧾')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'pay-methods'))
      .setLabel('Payment methods')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', panel.id, 'pay-help'))
      .setLabel('How it works')
      .setEmoji('❓')
      .setStyle(ButtonStyle.Secondary)
  );

  const components = [new ActionRowBuilder().addComponents(menu), row];
  const support = options.supportUrl || config.supportUrl;
  if (support) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Support').setURL(support).setStyle(ButtonStyle.Link)
      )
    );
  }

  return { embeds: [embed], components };
}

module.exports = { build, planEntries };
