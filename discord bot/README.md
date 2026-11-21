# Champ Discord bot

Production bot for the Champ Client Discord. Everything is available as a **clickGUI** inside
Discord: a persistent control panel, multiple named panels, tickets, giveaways, welcome/goodbye,
rules, announcements, moderation, a forum-backed knowledge base and a checkout that works without
leaving Discord.

One Node 20 process. No database required; Supabase and a mounted volume are optional upgrades.
Existing environment variable names are unchanged, and `.env` is never committed.

## Quick start

```bash
cd "website/discord bot"
npm ci
cp .env.example .env        # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
# DISCORD_BOT_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID work too; use one set for the site.
npm run deploy              # register the slash commands once
npm start
```

`npm run verify` syntax-checks every JS file and parses every JSON config (no token needed).
`npm run check` runs the offline behaviour tests (config, stores, panels, knowledge, payments,
tickets, giveaways, welcome, transcripts, health payload). It needs no token and leaves no data
behind.

The bot also registers its commands on every start unless `AUTO_DEPLOY_COMMANDS=false`, so a fresh
server never shows an empty slash-command list.

### Discord setup

1. Create the application at <https://discord.com/developers/applications> and add a bot.
2. Enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway
   Intents. Welcome messages, auto roles, mention support and forum knowledge need them.
3. Invite with `bot` + `applications.commands` and these permissions: **Manage Channels, Manage
   Roles, Send Messages, Embed Links, Attach Files, Read Message History, View Channels, Moderate
   Members, Kick Members, Ban Members, Manage Messages**. Forum knowledge also benefits from
   **Manage Threads** and **Manage Channels** (to create the configured tags).
4. Put the token, application id and server id in `.env`.
5. Run `/panel` once in a staff channel. That message is the control panel; every section is a
   menu, button or modal. Set `CONTROL_PANEL_CHANNEL_ID` if you want it posted automatically on
   startup and refreshed after every restart.

## The control panel

`/panel` posts a stored control panel. The bot edits the same message on restart instead of
posting duplicates. Its menu opens:

| Section | What you can do without a command |
| --- | --- |
| **Tickets** | Post a panel, see stats, list open tickets, set category/log/transcript channels, support role, max open, delete delay, transcript format, transcript DM and auto-close; add/remove members from the ticket message selects |
| **Panels** | Create, open, refresh, repost and delete any number of named panels |
| **Giveaways** | Create with prize/duration/winners/description/account age/role, list, end, reroll, delete |
| **Welcome** | Preview, send a test to this or another channel, enable/disable, pick welcome and goodbye channels, add/remove auto roles, toggle the DM, edit all texts, reset |
| **Rules** | Post to a channel, edit intro/footer, toggle the terms button, preview, reset |
| **Announcements** | Title, body, image, link button, channel, and @here/@everyone choice |
| **Moderation** | Timeout, kick, ban (with delete days), purge and slowmode, with the same checks and mod log as `/mod` |
| **Knowledge** | Browse, search, ask a question, set the forum, open/close questions, sync the forum |
| **Payments** | Buy a plan, view orders, see methods, and open the staff payment queue |
| **Status** | Uptime, ping, tickets, giveaways, knowledge, storage and version |
| **Help** | This feature map with website/dashboard/Discord links |

Staff actions check **Manage Server**, `staffRoleIds`, `supportRoleId` or the configured support
role name. A public panel never exposes the admin actions to members without those roles.

## Multiple panels

Every panel is a record in `DATA_DIR/panels.json`, not a hard-coded message. A server can run:

- several **ticket panels** (support, billing, media) from `/ticket-panel name:<name>` or
  **Panels → New panel → Ticket panel**;
- one or more **knowledge panels** in different channels;
- a **payment panel** with `/payments panel:#channel`;
- giveaway, rules, welcome, status and help panels.

The control panel's **Panels** section lists them. **Refresh** re-renders the stored message from
the current config; **Post again** sends a new copy and updates the record; **Delete** removes the
message and the record. On every restart the bot refreshes all stored panels, so a deploy never
leaves a dead button behind.

### Default #media and #tickets panels

When the server has channels named `media` and `tickets`, the bot posts (or updates) one panel in
each on startup. They are normal stored panels, so no duplicates appear after a restart:

| Channel | Panel | Categories |
| --- | --- | --- |
| `#media` | `media` | Payout · Apply for Media |
| `#tickets` | `tickets` | Refunds · Buy Champ Client · Buy Advertisement · Giveaway Claim · General Support · License Key Issues · Crashing Issues · AI Support |

The category list is enforced on every boot; edits to the panel copy in `panels.json` are kept. If
a channel is missing, the bot logs it as skipped and posts nothing there.

## Knowledge: the forum is the editor

There is deliberately **no `/knowledge add` command**. Knowledge is written as Discord forum
threads:

1. Set the forum in **Control panel → Knowledge → forum channel**. The choice is stored in
   `DATA_DIR/knowledge-settings.json`; `config/knowledge.json` holds the shipped defaults.
2. Use **Ask a question** from a knowledge panel to create a thread, or write a normal forum post.
3. Staff tag the thread (`Guide`, `FAQ`, `Troubleshooting`, `Billing`, `Question`) and edit the
   starter post. The bot syncs the title, body, tags, author and activity into a local index.
4. **Browse**, **Search** and the tag filter read that index; **Open thread** jumps back to the
   conversation and screenshots.

The bot maps configured tags to the forum's real tags by name and adds missing tags when it has
Manage Channels. Configured tags live in `config/knowledge.json`; the forum channel and the
question toggle are stored in `DATA_DIR/knowledge-settings.json`.

Forum events (`threadCreate`, `threadUpdate`, `threadDelete`, messages in a knowledge thread) keep
the index current. **Sync forum** re-indexes active and archived threads on demand; the bot also
runs an initial sync on startup. If the forum is not configured, the panels explain what to set
instead of failing.

## Payments inside Discord

The shop already owns prices, crypto/DonutSMP/gift-card rules, license generation and e-mail
delivery. The bot does not write licenses itself. It calls a small **bot-authenticated bridge** on
the Champ site, so a Discord purchase goes through exactly the same checks as the web checkout.

Flow:

1. The member links Discord on the dashboard with `/link code:<code>`.
2. `/payments` (or a payment panel) shows weekly, monthly and lifetime.
3. Choosing a plan fetches the live methods from `/api/payments/methods`.
4. **Crypto** creates the order and shows the exact amount, coin and address; **I paid — submit
   txid** sends the hash and refreshes the status.
5. **DonutSMP** asks for the Minecraft username and shows the amount and receiving account; the
   existing DonutSMP bot (or staff) confirms it.
6. **Gift card** asks for brand, value and code, then waits for staff review.
7. The license is generated by the site when the payment clears. The order view shows the key and
   expiry, and the dashboard link downloads the client.

Staff use **Payment queue** in the control panel to see pending/review orders and **Approve &
deliver** or **Reject** with a reason. Approving calls the site's existing
`complete_payment_order`, so the license is still created exactly once.

### Required site update

The Discord checkout needs the bot bridge in `website/api/index.py`:

- `POST /api/discord/bot/checkout`
- `GET /api/discord/bot/order/{uid}`
- `GET /api/discord/bot/orders`
- `POST /api/discord/bot/order/{uid}/crypto`
- `GET /api/discord/bot/payments`
- `GET /api/discord/bot/payments/{uid}`
- `POST /api/discord/bot/payments/{uid}/approve`
- `POST /api/discord/bot/payments/{uid}/reject`

They authenticate with `Authorization: Bot <DISCORD_BOT_TOKEN or DISCORD_TOKEN>` and never accept
a customer session. Deploy the site with the same bot token as the bot. Without the update the
payment panel still opens, but creating an order shows the site's 404/message instead of a
checkout.

No Stripe keys are used or stored by this bot. The site's enabled methods are the source of truth;
if none are enabled, the panel links to the website checkout/support instead.

## Commands (shortcuts, not the only way)

| Command | Who | What it does |
| --- | --- | --- |
| `/panel [channel]` | staff | Post the persistent control panel |
| `/ticket-panel [channel] [name]` | staff | Post a stored, refreshable ticket panel |
| `/ticket-close [reason]` | opener / staff | Close with transcript, DM and rating |
| `/ticket-add user:@member` | staff | Let someone else see and reply in the ticket |
| `/ticket-remove user:@member` | staff | Remove their access again |
| `/ticket-transcript` | staff | Export the conversation as `.txt` + `.html` |
| `/ticket-stats` | staff | Open/closed, 24h volume, ratings, top staff |
| `/giveaway create` | staff | Prize, minutes, winners, channel, role and account-age requirements |
| `/giveaway end [id]` · `reroll id [winners]` · `list` · `entries id` · `delete id` | staff | Manage giveaways |
| `/welcome status` · `preview` · `test` · `channel` · `autorole` · `dm` · `message` · `title` · `reset` | staff | Configure joins and leaves |
| `/payments [panel:#channel]` | everyone / staff | Buy in Discord, or post a persistent payment panel |
| `/link code:<code>` | everyone | Connect the Discord account to the Champ site account |
| `/announce` | staff | Branded announcement with optional @here/@everyone, image and link button |

The ticket message also has **Add member** and **Remove member** selects for staff, so the
ticket commands are shortcuts rather than the only way. A welcome test can be sent to a chosen
channel from the control panel.
| `/rules [channel]` | staff | Post the rules with a terms button |
| `/mod timeout user duration [reason]` | staff | Timeout for `10m` / `2h` / `1d` (max 28 days) |
| `/mod kick` · `/mod ban [delete_days]` | staff | Kick or ban, with a DM and a mod-log entry |
| `/mod purge count` · `/mod slowmode seconds` | staff | Clear up to 100 recent messages, or set slowmode |
| `/status` | everyone | Uptime, ping, servers, ticket, giveaway and knowledge counts |
| `/help` | everyone | Feature map with site, dashboard and Discord buttons |

## Tickets

- `config/tickets.json` holds the panel copy, categories, per-category questions, support role,
  naming pattern, log/transcript channels, rating prompt and auto-close rules. Discord edits are
  stored in `DATA_DIR/ticket-settings.json` and merged on top.
- A ticket opens as a private channel: the opener, the support roles and the bot can see it, and
  `@everyone` cannot. Up to 5 modal questions per category; 25 categories in the dropdown.
- **Claim** records who took the ticket and updates the channel topic. **Transcript** exports the
  conversation for staff. **Close** archives the transcript, DMs it to the opener, asks for a star
  rating and deletes the channel after `deleteDelaySeconds`.
- Transcripts are archived in three places: `transcriptChannelId` (or the log channel), the opener's
  DM, and `DATA_DIR/transcripts/*.html` on disk. A closed DM never loses the conversation.
- Inactive tickets warn once after `warningHours` and close after `inactiveHours`. Every member
  message clears the warning, so a replied-to ticket gets the full window again.
- A ticket channel deleted by hand is marked closed instead of staying open in the stats.
- One open ticket per member by default (`settings.maxOpenTicketsPerUser`), plus a 20 second
  creation cooldown to stop accidental double tickets.

## AI support tickets

The **AI Support** category has `"ai": true` in `config/tickets.json` and no modal questions, so it
opens straight into a private channel. From then on the bot answers every member message in that
channel instead of waiting for staff:

- The model gets the recent channel history, a fact sheet about Champ and the best-matching forum
  knowledge entries, so it can answer normal questions and small talk as well as support ones.
- It answers in the member's language (Dutch or English) and keeps replies short.
- It never invents order status, keys, refunds or ETAs. When staff action is needed — refund,
  payout, missing payment, license/order change, ban appeal — or when the member types `human`, it
  says a human will take over and pings the support role.
- Staff messages are not answered by the AI, and only channels of an AI ticket type are handled.
  Mentions elsewhere still get the short link reply, not the AI.

Set an OpenAI-compatible key to turn it on. Without a key the ticket still opens and the bot
immediately asks a human to help instead of failing.

```
OPENAI_API_KEY=sk-...
# optional, any OpenAI-compatible endpoint and model:
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

`AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` are accepted as aliases. For the Freebuff API use
`OPENAI_BASE_URL=https://freebuff.com/api/v1/paid` with a key from the Freebuff account page.
The key is read from the environment on the host; it is never sent to Discord or committed.

## Giveaways

- `/giveaway create` or the control panel posts an embed with a live **Enter** button; the label
  shows the entry count.
- Requirements can be a role, a minimum Discord account age, or both. Duplicate clicks do not add
  a second entry.
- The scheduler polls the persisted giveaways every 20 seconds, so a restart does not lose a timer.
  Ending edits the message, announces the winners with the entry total, and DMs them.
- Rerolls exclude earlier winners until everyone has won once. The host or staff can end early.
- Giveaways are scoped to their server: a button from server A cannot be used in server B.

## Welcome system

`config/welcome.json` is the shipped default; `/welcome` or the control panel stores overrides in
`DATA_DIR/welcome.json`, so a redeploy keeps them. Placeholders: `{user}`, `{mention}`,
`{username}`, `{tag}`, `{server}`, `{memberCount}`, `{accountAgeDays}`, `{createdAt}`, `{site}`,
`{rules}`.

On join the bot adds the auto roles, posts the embed with the avatar and member count, and sends
the DM when enabled. Link buttons come from `links` in `config/welcome.json`; `${site}` is
replaced, non-http links are dropped, and at most five are shown. On leave it posts the goodbye
embed in the goodbye channel, or the welcome channel if none is set.

## Account linking

The site dashboard creates an 8-character, 10-minute code for the signed-in customer. The member
runs `/link code:<code>`; the bot calls `SITE_URL/api/discord/bot/link` with its bot token, and the
site stores the Discord id on that customer account. The Discord id comes from the command author,
never from a value the member types. If the account has an active license the bot also assigns the
Champ+ role. Discord payments require this link, because the site needs a customer account to
deliver the license.

Mentioning the bot does not call the AI. It replies once per minute with the dashboard, ticket and
Discord support links; AI answers live only inside an AI support ticket.

## Storage

| Data | Default | Optional |
| --- | --- | --- |
| Tickets | `DATA_DIR/tickets.json` | Supabase `public.tickets` |
| Transcripts | `DATA_DIR/transcripts/*.html` | also posted to a channel and DM |
| Giveaways | `DATA_DIR/giveaways.json` | — |
| Welcome overrides | `DATA_DIR/welcome.json` | — |
| Ticket settings | `DATA_DIR/ticket-settings.json` | — |
| Knowledge index | `DATA_DIR/knowledge.json` | rebuilt from the forum |
| Knowledge settings | `DATA_DIR/knowledge-settings.json` | — |
| Rule overrides | `DATA_DIR/rules.json` | — |
| Panels | `DATA_DIR/panels.json` | — |
| Control panel pointer | `DATA_DIR/control.json` | — |

Set `DATA_DIR` to a mounted volume (for example `/data` on Railway) so restarts keep everything.
The last 500 transcript files are kept automatically.

With `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set, the bot probes `public.tickets` at boot. Apply
[`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor first. If the table is
missing or unreachable, the bot logs the exact error and falls back to JSON instead of failing.

## Environment

Existing names are preserved. Either Discord name works:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` / `DISCORD_BOT_TOKEN` | yes | Bot login and `/link` + Discord checkout auth |
| `CLIENT_ID` / `DISCORD_CLIENT_ID` | for deploy | Slash-command application id |
| `GUILD_ID` / `DISCORD_GUILD_ID` | recommended | Instant guild command registration |
| `SITE_URL` | yes for payments | Website API base, e.g. `https://champ-site-psi.vercel.app` |
| `DISCORD_INVITE` | no | Invite link in help/mention replies |
| `PORT` / `HEALTH_PORT` | host-provided | Enables `/health` |
| `LOG_LEVEL` | no | `error`, `warn`, `info` or `debug` |
| `ERROR_LOG_CHANNEL_ID` | no | Mirrors bot errors to a channel |
| `MOD_LOG_CHANNEL_ID` | no | Moderation log |
| `AUTO_DEPLOY_COMMANDS` | no | `false` disables automatic command registration |
| `DATA_DIR` | volume | Persistent state |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | no | Shared ticket history |
| `CONTROL_PANEL_CHANNEL_ID` | no | Post/refresh the control panel here on startup |
| `OPENAI_API_KEY` / `AI_API_KEY` | for AI tickets | Enables the AI support conversation (OpenAI-compatible) |
| `OPENAI_BASE_URL` / `AI_BASE_URL` | no | Chat-completions base URL, default `https://api.openai.com/v1` |
| `OPENAI_MODEL` / `AI_MODEL` | no | Model name, default `gpt-4o-mini` |

Never commit `.env`. The site also needs its own `DISCORD_BOT_TOKEN` (or `DISCORD_TOKEN`) and the
same `SITE_URL` so the bridge can verify the bot.

## Health endpoint

Set `PORT` (Railway injects it) and the bot serves:

- `GET /health` (also `/healthz`) — JSON: `status`, `ready`, `version`, `uptime`, `guilds`, `pingMs`,
  ticket counts, active giveaways and storage mode. Answers `200` even while the gateway is still
  connecting, so a deploy healthcheck does not kill a slow start; `503` only during shutdown.
- `GET /` — plain text `ok`.

## Deploy

### Railway

1. New service from the repository, root directory `website/discord bot`.
2. Add the variables from `.env.example` (at minimum `DISCORD_TOKEN` or `DISCORD_BOT_TOKEN`, a
   client id and `SITE_URL`; `GUILD_ID` or `DISCORD_GUILD_ID` for instant commands). The site
   accepts the same values, so one token can serve both services.
3. Attach a volume and mount it at `/data`; set `DATA_DIR=/data`.
4. `railway.json` already sets `npm start` and healthcheck `/health`. Railway injects `PORT`.
5. Deploy, then run `npm run deploy` once locally if you disabled auto registration.
6. Deploy the updated `website/api/index.py` so the Discord checkout bridge exists.

### Docker

```bash
docker build -t champ-bot .
docker run -d --name champ-bot --env-file .env -v champ-data:/data -p 8080:8080 champ-bot
```

The image runs as the unprivileged `node` user, keeps `/data` for state and ships a container
healthcheck against `/health`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `DISCORD_TOKEN is missing` | No `.env` or no variable on the host; copy `.env.example`. `DISCORD_BOT_TOKEN` is accepted instead. |
| Slash commands are empty | Set `CLIENT_ID` (and `GUILD_ID` for instant registration) and restart. |
| Control panel posts twice | It edits the stored message; if the old message was deleted it reposts once. Check `DATA_DIR` is persistent. |
| A panel button says it is out of date | Open **Control panel → Panels → Refresh**, or run `/ticket-panel` again. |
| Tickets fail with “Manage Channels” | Give the bot role Manage Channels; re-invite if needed. |
| Transcript DM missing | The member closed DMs; the archive channel and disk copy still have it. |
| Welcome posts nothing | Set the channel in **Control panel → Welcome → Settings** and check the boot audit warnings. |
| Knowledge browse is empty | Set the forum in **Control panel → Knowledge**, then press **Sync forum**. Check the thread tags match `config/knowledge.json`. |
| Knowledge question fails | The bot needs **Create Public Threads** in the forum and the forum channel must exist. |
| Payment says “Link your Discord account” | Run `/link code:<code>` with a code from the dashboard, then retry. |
| Payment checkout returns 404 | The site was not redeployed with the `/api/discord/bot/*` bridge, or `SITE_URL` points at an older deployment. |
| Payment queue approve fails | Check the site's Supabase service key and that the order is still pending/review. |
| Bot restarts on Railway | Look at `/health` and the error channel (`ERROR_LOG_CHANNEL_ID`). |

## Launch checklist

- [ ] `.env` on the host has token, client id, guild id, site URL.
- [ ] Bot role has Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read
      Message History, Moderate Members, Kick Members, Ban Members, Manage Messages.
- [ ] `/panel` posted in a staff channel; `CONTROL_PANEL_CHANNEL_ID` set if it should refresh
      automatically.
- [ ] `MOD_LOG_CHANNEL_ID` set to a staff-only channel; `/mod timeout` logs there.
- [ ] Rules panel posted; the text matches `config/rules.json` or the in-Discord edits.
- [ ] Ticket panel posted; category, log and transcript channels set in **Tickets → Settings**.
- [ ] Support role name matches `defaultSupportRoleName` (or set the role id).
- [ ] Welcome channels/auto roles set; **Welcome → Preview** looks right.
- [ ] Knowledge forum set and tags created; **Sync forum** finds the threads.
- [ ] Site redeployed with the Discord checkout bridge; `/payments` creates a test order.
- [ ] Dashboard Discord link tested with `/link code:<code>`; a paid order shows the key.
- [ ] `/status` answers and `/health` returns `ready: true`.
- [ ] `npm run verify && npm run check` pass.
