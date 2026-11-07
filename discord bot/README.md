# Champ Discord bot

Production bot for the Champ Client Discord: support tickets with transcripts and ratings,
giveaways that survive restarts, a welcome/goodbye system with auto roles and link buttons,
AI support on mention, and a health endpoint for the host.

One Node 20 process. No database required; Supabase and a mounted volume are optional upgrades.

## Quick start

```bash
cd "website/discord bot"
npm ci
cp .env.example .env        # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm run deploy              # register the slash commands once
npm start
```

`npm run verify` syntax-checks every JS file and parses every JSON config (no token needed).
`npm run check` runs the offline behaviour tests (config, stores, giveaways, welcome, transcripts,
health payload). It needs no token and leaves no data behind.

The bot also registers its commands on every start unless `AUTO_DEPLOY_COMMANDS=false`, so a fresh
server never shows an empty slash-command list.

### Discord setup

1. Create the application at <https://discord.com/developers/applications> and add a bot.
2. Enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway
   Intents. Welcome messages, auto roles and mention support need them.
3. Invite with `bot` + `applications.commands` and these permissions: **Manage Channels, Manage
   Roles, Send Messages, Embed Links, Attach Files, Read Message History, View Channels, Moderate
   Members, Kick Members, Ban Members, Manage Messages**.
4. Put the token, application id and server id in `.env`.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/ticket-panel [channel]` | staff | Post the support dropdown |
| `/ticket-close [reason]` | opener / staff | Close with transcript, DM and rating |
| `/ticket-add user:@member` | staff | Let someone else see and reply in the ticket |
| `/ticket-remove user:@member` | staff | Remove their access again |
| `/ticket-transcript` | staff | Export the conversation as `.txt` + `.html` |
| `/ticket-stats` | staff | Open/closed, 24h volume, ratings, top staff |
| `/giveaway create` | staff | Prize, minutes, winners, channel, role and account-age requirements |
| `/giveaway end [id]` · `reroll id [winners]` · `list` · `entries id` · `delete id` | staff | Manage giveaways |
| `/welcome status` · `preview` · `test` · `channel` · `autorole` · `dm` · `message` · `title` · `reset` | staff | Configure joins and leaves |
| `/announce` | staff | Branded announcement with optional @here/@everyone, image and link button |
| `/rules [channel]` | staff | Post the rules from `config/rules.json` with a terms button |
| `/mod timeout user duration [reason]` | staff | Timeout for `10m` / `2h` / `1d` (max 28 days) |
| `/mod kick` · `/mod ban [delete_days]` | staff | Kick or ban, with a DM to the member and a mod-log entry |
| `/mod purge count` · `/mod slowmode seconds` | staff | Clear up to 100 recent messages, or set slowmode |
| `/status` | everyone | Uptime, ping, servers, ticket and giveaway counts |
| `/help` | everyone | Command overview with site, dashboard and Discord buttons |

Staff means **Manage Server**, a role in `staffRoleIds` / `supportRoleId`, or the configured support
role name (default `Support`). Moderation never acts on the server owner or on a role at or above
the moderator's own, and every action is mirrored to `MOD_LOG_CHANNEL_ID` when that is set.

## Tickets

- `config/tickets.json` holds the panel copy, categories, per-category questions, support role,
  naming pattern, log/transcript channels, rating prompt and auto-close rules.
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

## Giveaways

- `/giveaway create` posts an embed with a live **Enter** button; the label shows the entry count.
- Requirements can be a role, a minimum Discord account age, or both. Duplicate clicks do not add
  a second entry.
- The scheduler polls the persisted giveaways every 20 seconds, so a restart does not lose a timer.
  Ending edits the message, announces the winners with the entry total, and DMs them.
- Rerolls exclude earlier winners until everyone has won once. The host or staff can end early.
- Giveaways are scoped to their server: a button from server A cannot be used in server B.

## Welcome system

`config/welcome.json` is the shipped default; `/welcome` changes are stored as overrides in
`DATA_DIR/welcome.json`, so a redeploy keeps them. Placeholders: `{user}`, `{mention}`,
`{username}`, `{tag}`, `{server}`, `{memberCount}`, `{accountAgeDays}`, `{createdAt}`, `{site}`,
`{rules}`.

On join the bot adds the auto roles, posts the embed with the avatar and member count, and sends
the DM when enabled. The three link buttons come from `links` in `config/welcome.json`; `${site}` is
replaced, non-http links are dropped, and at most five are shown. On leave it posts the goodbye
embed in the goodbye channel, or the welcome channel if none is set.

## AI support

When a member mentions the bot, the question goes to `SUPPORT_API_URL` (default
`SITE_URL/api/ai/chat`) with the channel id as the Discord session. Answers are capped at 1800
characters, the bot shows a typing indicator, and failures fall back to a ticket invite. There is
an 8 second per-member cooldown.

## Storage

| Data | Default | Optional |
| --- | --- | --- |
| Tickets | `DATA_DIR/tickets.json` | Supabase `public.tickets` |
| Transcripts | `DATA_DIR/transcripts/*.html` | also posted to a channel and DM |
| Giveaways | `DATA_DIR/giveaways.json` | — |
| Welcome overrides | `DATA_DIR/welcome.json` | — |

Set `DATA_DIR` to a mounted volume (for example `/data` on Railway) so restarts keep the files.
The last 500 transcript files are kept automatically.

With `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set, the bot probes `public.tickets` at boot. Apply
[`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor first. If the table is
missing or unreachable, the bot logs the exact error and falls back to JSON instead of failing.

## Health endpoint

Set `PORT` (Railway injects it) and the bot serves:

- `GET /health` (also `/healthz`) — JSON: `status`, `ready`, `version`, `uptime`, `guilds`, `pingMs`,
  ticket counts, active giveaways and storage mode. Answers `200` even while the gateway is still
  connecting, so a deploy healthcheck does not kill a slow start; `503` only during shutdown.
- `GET /` — plain text `ok`.

## Deploy

### Railway

1. New service from the repository, root directory `website/discord bot`.
2. Add the variables from `.env.example` (at minimum `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`,
   `SITE_URL`).
3. Attach a volume and mount it at `/data`; set `DATA_DIR=/data`.
4. `railway.json` already sets `npm start` and healthcheck `/health`. Railway injects `PORT`.
5. Deploy, then run `npm run deploy` once locally if you disabled auto registration.

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
| `DISCORD_TOKEN is missing` | No `.env` or no variable on the host; copy `.env.example`. |
| Slash commands are empty | Set `CLIENT_ID` (and `GUILD_ID` for instant registration) and restart. |
| Tickets fail with “Manage Channels” | Give the bot role Manage Channels; re-invite if needed. |
| Transcript DM missing | The member closed DMs; the archive channel and disk copy still have it. |
| Welcome posts nothing | `/welcome channel welcome:#…` and check the boot audit warnings. |
| Ticket stats look empty | Supabase is configured but the schema was never applied; check the boot log. |
| Bot restarts on Railway | Look at `/health` and the error channel (`ERROR_LOG_CHANNEL_ID`). |

## Launch checklist

- [ ] `.env` on the host has token, client id, guild id, site URL.
- [ ] Bot role has Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read
      Message History, Moderate Members, Kick Members, Ban Members, Manage Messages.
- [ ] `MOD_LOG_CHANNEL_ID` set to a staff-only channel; `/mod timeout` logs there.
- [ ] `/rules` posted in `#rules`; the text matches `config/rules.json`.
- [ ] `/announce` tested once in a staff channel before the launch post.
- [ ] `/ticket-panel` posted in `#support`; `ticketCategoryId`, `logChannelId` and
      `transcriptChannelId` filled in.
- [ ] Support role name matches `defaultSupportRoleName` (or `supportRoleId` set).
- [ ] `/welcome channel` and auto roles configured; `/welcome preview` looks right.
- [ ] `/status` answers and `/health` returns `ready: true`.
- [ ] `npm run verify && npm run check` pass.
