/* The module catalogue of the Features page.
   Each module has its own slug, so the admin panel can attach a screenshot, a video and a
   longer description to it. The text here is the default; anything saved in the admin panel
   overrides it. Categories are shown as filter chips, "All" shows everything. */
window.CHAMP_FEATURES = {
  categories: [
    { id: 'combat', label: 'Combat', icon: '⚔️', blurb: 'Trigger bot, kill aura, carts and every PvP macro.' },
    { id: 'crystal', label: 'Crystal', icon: '💎', blurb: 'Anchors, crystals, obsidian and totems.' },
    { id: 'mace', label: 'Mace', icon: '🔨', blurb: 'Mace timing, pearl catches and windcharge clutches.' },
    { id: 'spear', label: 'Spear', icon: '🗡️', blurb: 'Lunge swaps and spear to mace double taps.' },
    { id: 'movement', label: 'Movement', icon: '🏃', blurb: 'Sprint, wtap, bridging and a real freecam.' },
    { id: 'misc', label: 'Misc', icon: '🧰', blurb: 'Quality of life: tools, potions, refills and friends.' },
    { id: 'visual', label: 'Visuals', icon: '👀', blurb: 'XRay, ESP, animations and overlays.' },
    {
      id: 'donut',
      label: 'Donut SMP',
      icon: '🍩',
      blurb: 'Market, mining and base raiding tools.',
      note: 'Donut SMP only. Joining any other server with one of these modules on shows a warning.'
    }
  ],
  modules: [
    // Combat
    { slug: 'trigger-bot', category: 'combat', title: 'Trigger Bot', description: 'Attacks the moment your crosshair touches an enemy, with an adjustable reaction delay and a friends whitelist.' },
    { slug: 'kill-aura', category: 'combat', title: 'Kill Aura', description: 'Keeps hitting every enemy in range with silent aim, adjustable swing speed and a target filter.' },
    { slug: 'aim-assist', category: 'combat', title: 'Aim Assist', description: 'Pulls your aim towards the closest enemy while you swing, with sliders for strength and smoothing.' },
    { slug: 'auto-cart', category: 'combat', title: 'Auto Cart', description: 'When you shoot a bow it places a rail and a TNT minecart on the arrow path and detonates it.' },
    { slug: 'auto-xbow-cart', category: 'combat', title: 'Auto XBow Cart', description: 'A macro that performs the full crossbow minecart combo for you in a single keypress.' },
    { slug: 'auto-safe-cart', category: 'combat', title: 'Auto Safe Cart', description: 'Places blocks around the cart so you take far less explosion damage.' },
    { slug: 'instant-shield', category: 'combat', title: 'Instant Shield', description: 'Takes your shield out of your inventory, raises it and puts it back. Toggleable with a keybind.' },
    { slug: 'auto-shield-breaker', category: 'combat', title: 'Auto Shield Breaker', description: 'Spams axe hits the moment someone raises a shield until it breaks. The axe does not need to be in your hotbar.' },
    { slug: 'cart-aura', category: 'combat', title: 'Cart Aura', description: 'Instantly carts the enemies close to you, with a safe cart option built in.' },
    { slug: 'safe-xbow-cart', category: 'combat', title: 'Safe XBow Cart', description: 'Places a slab so the crossbow cart explosion hurts you much less.' },
    { slug: 'xbow-cart-aura', category: 'combat', title: 'XBow Cart Aura', description: 'The crossbow version of Cart Aura: automatically xbow carts nearby enemies.' },
    { slug: 'expand-hitboxes', category: 'combat', title: 'Expand Hitboxes', description: 'Makes enemy hitboxes bigger, with a slider for how much they expand.' },
    { slug: 'instant-crossbow', category: 'combat', title: 'Instant Crossbow', description: 'Takes the crossbow out of your inventory, shoots it and puts it straight back.' },
    { slug: 'auto-drain', category: 'combat', title: 'Auto Drain', description: 'Drains a target totem by totem with the timing you configure.' },
    { slug: 'reach', category: 'combat', title: 'Reach', description: 'Extends how far you can hit, with a slider and a warning when the value becomes very detectable.' },

    // Crystal
    { slug: 'auto-respawn-anchor', category: 'crystal', title: 'Auto Respawn Anchor', description: 'Fills a placed respawn anchor with one glowstone, swaps to the hotbar slot you selected and detonates it.' },
    { slug: 'anchor-macro', category: 'crystal', title: 'Anchor Macro', description: 'One keybind places an anchor, fills it with glowstone and explodes it using your selected hotbar slot.' },
    { slug: 'auto-obsidian', category: 'crystal', title: 'Auto Obsidian', description: 'Places obsidian instantly on your keybind, ready for the next crystal.' },
    { slug: 'auto-crystal', category: 'crystal', title: 'Auto Crystal', description: 'Places and breaks a crystal on the obsidian you look at, using silent aim.' },
    { slug: 'auto-totem', category: 'crystal', title: 'Auto Totem', description: 'Keeps a totem in your offhand at all times.' },

    // Mace
    { slug: 'auto-mace', category: 'mace', title: 'Auto Mace', description: 'Silent aim mace hits with stun slam options: minimum fall distance and how many ticks the stun slam waits.' },
    { slug: 'auto-pearl-catch', category: 'mace', title: 'Auto Pearl Catch', description: 'Throws a pearl and then a windcharge straight up with silent aim. Per-action delays, optional elytra take-off with chestplate swap and a breach check that picks a breach mace below 10.1 blocks and a density mace above it.' },
    { slug: 'auto-windcharge-pearl-catch', category: 'mace', title: 'Auto Windcharge Pearl Catch', description: 'Tracks your pearl and throws the windcharge at it instead of where you look, a little below the pearl so it really connects. Fully automatic mode and a configurable delay.' },
    { slug: 'shield-drain', category: 'mace', title: 'Shield Drain', description: 'Spams mace hits on a raised shield until it breaks, with clicks per tick and a warning when stun slam is enabled.' },
    { slug: 'auto-elytra', category: 'mace', title: 'Auto Elytra', description: 'One keybind equips your elytra and puts fireworks in your hand when they are in your inventory.' },
    { slug: 'windcharge-clutch', category: 'mace', title: 'Windcharge Clutch', description: 'Breaks your fall with a silent aim windcharge. Delay, swap back and minimum fall distance are configurable.' },
    { slug: 'auto-totem-mace', category: 'mace', title: 'Auto Totem (Mace)', description: 'Keeps a totem in your offhand while you mace and swaps back to the mace after a totem pops.' },

    // Spear
    { slug: 'instant-lunge', category: 'spear', title: 'Instant Lunge', description: 'Searches your inventory for the spear with the highest lunge enchantment, attribute swaps to it and swaps back after your delay. Turns itself off after the action.' },
    { slug: 'spear-mace-double-tap', category: 'spear', title: 'Spear Mace Double Tap', description: 'Hold right click with your spear; once the spear lands you instantly mace the target for a double tap through totems. Auto Mace turns off while this is active.' },
    { slug: 'extended-spear-reach', category: 'spear', title: 'Extended Spear Reach', description: 'Adds reach to the spear by attribute swapping to the mace while you charge.' },
    { slug: 'spear-silent-aim', category: 'spear', title: 'Spear Silent Aim', description: 'Silent aim assist for spear throws, with charge prediction and a field of view slider so you never look away.' },

    // Movement
    { slug: 'sprint', category: 'movement', title: 'Sprint', description: 'Sprints automatically whenever you move.' },
    { slug: 'wtap', category: 'movement', title: 'WTap', description: 'Taps W for you so you keep sprint reset momentum in a fight.' },
    { slug: 'auto-jump-reset', category: 'movement', title: 'Auto Jump Reset', description: 'Jumps the moment you get hit to cut knockback.' },
    { slug: 'fast-bridge', category: 'movement', title: 'Fast Bridge', description: 'Places blocks much faster while you bridge, with a configurable place delay.' },
    { slug: 'freecam', category: 'movement', title: 'Freecam', description: 'Detaches the camera and flies around your body with adjustable speed and smooth acceleration, while your character stays exactly where it is.' },
    { slug: 'no-jump-delay', category: 'movement', title: 'No Jump Delay', description: 'Removes the delay between jumps.' },

    // Misc
    { slug: 'cart-refill', category: 'misc', title: 'Cart Refill', description: 'Refills the hotbar slots you selected with TNT minecarts.' },
    { slug: 'criticals', category: 'misc', title: 'Criticals', description: 'Turns normal hits into critical hits.' },
    { slug: 'auto-pot', category: 'misc', title: 'Auto Pot', description: 'Throws your healing or speed potion automatically when you need it.' },
    { slug: 'auto-text', category: 'misc', title: 'Auto Text', description: 'Sends the chat message you configured, on a keybind or on a timer.' },
    { slug: 'auto-tool', category: 'misc', title: 'Auto Tool', description: 'Swaps to the best tool for the block you are mining.' },
    { slug: 'auto-armour', category: 'misc', title: 'Auto Armour', description: 'Swaps to the best armour piece in your inventory when yours breaks.' },
    { slug: 'crystal-optimizer', category: 'misc', title: 'Crystal Optimizer', description: 'Does not wait for the server to break the crystal before placing the next one.' },
    { slug: 'fast-xp', category: 'misc', title: 'Fast XP', description: 'Throws XP bottles faster than vanilla.' },
    { slug: 'fast-place-break', category: 'misc', title: 'Fast Place / Break', description: 'Removes the place and break delays.' },
    { slug: 'friends', category: 'misc', title: 'Friends', description: 'Never attacks the teammates and friends you add to the list.' },
    { slug: 'pot-refill', category: 'misc', title: 'Pot Refill', description: 'Refills the hotbar slots you selected with your splash potions.' },
    { slug: 'name-hider', category: 'misc', title: 'Name Hider', description: 'Hides your name in F5 and in chat.' },
    { slug: 'randomizer', category: 'misc', title: 'Randomizer', description: 'Randomises your name in F5 and chat so screenshots and clips reveal nothing.' },
    { slug: 'right-clicker', category: 'misc', title: 'Right Clicker', description: 'Uses your item continuously while the module is on.' },
    { slug: 'streamer-mode', category: 'misc', title: 'Streamer Mode', description: 'Hides names in chat, tab and overlays so nothing ends up in your stream.' },

    // Visuals
    { slug: 'seed-xray', category: 'visual', title: 'Seed XRay', description: 'Enter the world seed, pick the ores you want and they are highlighted around you.' },
    { slug: 'xray-ultimate', category: 'visual', title: 'XRay Ultimate', description: 'Classic full XRay: only the ores you select stay visible.' },
    { slug: 'no-force-texture-pack', category: 'visual', title: 'No Force Texture Pack', description: 'Tries to stop the server from forcing its texture pack on you.' },
    { slug: 'animations', category: 'visual', title: 'Animations', description: 'Custom swing and hit animations with adjustable speed and style.' },
    { slug: 'esp', category: 'visual', title: 'ESP', description: 'Draws players through walls with boxes, names and health.' },
    { slug: 'storage-esp', category: 'visual', title: 'Storage ESP', description: 'Highlights chests, barrels, shulkers and other storage through walls.' },
    { slug: 'spawner-finder', category: 'visual', title: 'Spawner Finder', description: 'Finds and highlights spawners around you.' },
    { slug: 'health-indicator', category: 'visual', title: 'Health Indicator', description: 'Shows the health of the player you are looking at.' },
    { slug: 'item-esp', category: 'visual', title: 'Item ESP', description: 'Highlights dropped items so nothing gets lost.' },
    { slug: 'faster-totem-animation', category: 'visual', title: 'Faster Totem Animation', description: 'Shortens the totem pop animation that blocks your screen.' },
    { slug: 'shield-status', category: 'visual', title: 'Shield Status', description: 'Shows whether the enemy shield is up or on cooldown.' },
    { slug: 'potion-timer', category: 'visual', title: 'Potion Timer', description: 'Counts down your active potion effects.' },

    // Donut SMP
    { slug: 'auto-schematic-builder', category: 'donut', title: 'Auto Schematic Builder', description: 'Load a schematic, scan the market for the material cost and buy what is missing yourself or let the bot do it. Includes leaving when a player comes near.' },
    { slug: 'auto-mine-area', category: 'donut', title: 'Auto Mine Out Area', description: 'Pick the corners or enter the X, Y and Z size from where you stand and it mines the whole area out with the pickaxe you choose.' },
    { slug: 'resell', category: 'donut', title: 'Resell', description: 'Scans the market for underpriced items, buys them and relists them on the auction house for profit.' },
    { slug: 'base-finder', category: 'donut', title: 'Base Finder', description: 'Flies with an elytra until it finds a base, warns you and sets a home when there is room.' }
  ]
};
