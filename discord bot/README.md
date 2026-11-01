# Champ Discord bot

Tickets, giveaways and welcome automation for the Champ Client Discord. One Node process, no
database required (Supabase and a volume are optional upgrades).

## Setup

1. Create the application at <https://discord.com/developers/applications> and add a bot.
2. Enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway
   Intents. The welcome system and the support mention do not work without them.
3. Invite the bot with `bot` + `applications.commands` and these permissions: Manage Channels,
   Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History.
4. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID`.
5. Install, register the slash commands and start:

```bash
npm install
npm run deploy
npm start
```

`npm run check` runs the offline smoke test (config, giveaway draw, stores, welcome rendering,
transcripts). It needs no token and leaves no data behind.

## Tickets

- `config/tickets.json` holds the panel copy, the categories, the questions per category, the
  support role, transcript settings and the auto-close rules.
- Post the panel with `/ticket-panel channel:#support`. The dropdown opens a modal, creates a
  private channel, pings the support role and logs the event.
- Ticket buttons: **Claim** (staff), **Close** (opener or staff). Closing generates a `.txt` and
  `.html` transcript, DMs it to the opener, asks for a star rating and deletes the channel.
- `/ticket-stats` shows open/closed counts, the average rating and the top staff by claims.
- Inactive tickets warn after `warningHours` and close after `inactiveHours` (checked every 15
  minutes). The timer survives restarts because activity is stored with the ticket.

## Giveaways

- `/giveaway create` — prize, duration in minutes, winners, optional channel, description,
  required role and a minimum Discord account age. The message gets an **Enter** button whose
  label shows the live entry count.
- `/giveaway end [id]`, `/giveaway reroll id [winners]`, `/giveaway list`,
  `/giveaway entries id`, `/giveaway delete id`.
- A scheduler in the bot ends giveaways exactly when their timer runs out, including after a
  restart. Ending edits the message, announces the winners, and DMs them when `dmWinners` is on.
- Staff are members with **Manage Server** or one of `managerRoleIds` in `config/giveaway.json`.
  The host can end their own giveaway.
- Entries are stored per user: clicking twice does not add a second entry, and rerolls exclude
  earlier winners until everyone has won once.

## Welcome system

`config/welcome.json` ships the default copy; changes made with `/welcome` are stored separately
and merged on top, so a redeploy does not wipe them.

| Command | Effect |
| --- | --- |
| `/welcome status` | Shows channel, DM, auto roles and the placeholder list |
| `/welcome preview` | Sends the welcome embed only to you |
| `/welcome test [channel]` | Posts a real welcome message for yourself |
| `/welcome channel welcome:#x goodbye:#y` | Sets the join and leave channels |
| `/welcome autorole mode:add/remove/list role:@x` | Roles every new member receives |
| `/welcome dm enabled:true message:...` | Turns the welcome DM on/off and edits it |
| `/welcome message kind:welcome/goodbye/dm text:...` | Edits the message body |
| `/welcome title kind:welcome/goodbye text:...` | Edits the embed title |
| `/welcome reset` | Drops every override and returns to the file defaults |

Placeholders work in the title, the body and the DM: `{user}`, `{mention}`, `{username}`,
`{tag}`, `{server}`, `{memberCount}`, `{accountAgeDays}`, `{createdAt}`, `{site}`, `{rules}`.

On join the bot adds the auto roles, posts the embed (with the avatar as thumbnail and the
member count), and sends the DM if enabled. On leave it posts the goodbye embed in the goodbye
channel, or in the welcome channel when no separate goodbye channel is set.

## Storage

| Data | Default | Optional |
| --- | --- | --- |
| Tickets | `data/tickets.json` | Supabase table from `supabase/schema.sql` |
| Giveaways | `data/giveaways.json` | — |
| Welcome overrides | `data/welcome.json` | — |

Set `DATA_DIR` to a mounted volume (for example `/data` on Railway) so restarts keep the JSON
files. With `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, tickets live in Supabase instead and
the website can read the same rows.

## Hosting

Railway (or any Node 20+ host) runs it with `npm start`. Set the service root to
`website/discord bot`, add the variables from `.env.example`, and attach a volume mounted at the
path you put in `DATA_DIR`. The bot logs in once; a missing token exits with a clear message
instead of crashing silently.
