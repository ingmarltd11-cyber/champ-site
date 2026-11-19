const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { siteUrl, truncate } = require('./format');

const RULES_PATH = path.join(__dirname, '..', '..', 'config', 'rules.json');

// Read on every use so a rule can be edited and reposted without a restart. `overrides` lets
// the in-Discord editor change the intro/footer/terms switch without rewriting the JSON file.
function loadRules(overrides = null) {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const rules = JSON.parse(raw);
  if (!rules || typeof rules !== 'object') throw new Error('rules.json must contain an object');
  if (!Array.isArray(rules.sections) || rules.sections.length === 0) {
    throw new Error('rules.json needs at least one section');
  }
  if (rules.sections.length > 25) throw new Error('Discord allows at most 25 rule sections');
  for (const [index, section] of rules.sections.entries()) {
    if (!section?.title || !section?.body) {
      throw new Error(`section ${index + 1} needs a title and a body`);
    }
    if (String(section.body).length > 1024) {
      throw new Error(`section ${index + 1} is longer than 1024 characters`);
    }
  }
  return overrides && typeof overrides === 'object' ? { ...rules, ...overrides } : rules;
}

function buildRulesPayload(rules) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'CHAMP CLIENT', iconURL: `${siteUrl()}/assets/logo-teal.png` })
    .setTitle(truncate(rules.title || 'Server rules', 256))
    .setColor(rules.color || '#2EC4B6')
    .setTimestamp()
    .setFooter({ text: truncate(rules.footer || 'Champ Client', 2048) });

  if (rules.intro) embed.setDescription(truncate(rules.intro, 4096));
  embed.addFields(
    rules.sections.map((section) => ({
      name: truncate(section.title, 256),
      value: truncate(section.body, 1024),
    }))
  );

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (rules.showTermsButton !== false) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Terms of service')
          .setURL(`${siteUrl()}/terms.html`)
          .setStyle(ButtonStyle.Link)
      ),
    ];
  }
  return payload;
}

module.exports = { RULES_PATH, loadRules, buildRulesPayload };
