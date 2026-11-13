# Champ DonutSMP payment bot

> This bot is optional. The shop's default DonutSMP mode is **manual review**: the admin sets a
> receiving username, customers pay it in-game, and the admin approves the order in the payment
> queue. No Railway account, local process or bot host is required for that mode.

The bot stays in DonutSMP 24/7, polls the Champ API for unpaid DonutSMP orders, and watches
chat for incoming payments. When a payment matches an order it calls the website, and the
website unlocks the license. The bot never touches Supabase directly.

## What it needs

- A Minecraft Java account with a Microsoft login (`MC_EMAIL`).
- A persistent volume for `MC_PROFILES_DIR` so the Microsoft token survives restarts.
  Without a volume every restart can need a new device-code login.
- The same `DONUT_BOT_TOKEN` on this service and on the Vercel site.
- The bot's username as the DonutSMP username in **Admin → Payments**. That is the account
  customers pay to.

The first start prints a Microsoft device-code URL in the logs. Open it once while signed in
to the bot's Microsoft account. The token is then cached in the profiles folder.

## Railway

1. Create a new Railway service from this repository and set the root directory to
   `website/donut-bot`.
2. Railway uses the included `Dockerfile` and `railway.json`.
3. Add the variables from `.env.example`. Set `PORT` is provided by Railway automatically;
   the health endpoint returns 200 only while the bot is connected.
4. Attach a volume at `/data` and set `MC_PROFILES_DIR=/data/minecraft-auth`.
5. Deploy and open the logs. Wait for `spawned as ...; watching for payments`.

## Payment messages

DonutSMP's exact wording is server-owned and can change. The bot has four common patterns
built in. If payments are not detected, copy the real chat line from the logs and set
`DONUT_PAY_REGEX` to a named-group regex, for example:

```
^(?<sender>[A-Za-z0-9_]{3,16}) paid you \$?(?<amount>[\d,]+)
```

The amount may contain commas. The bot only confirms when:

- the sender's username matches the username on a pending order (case-insensitive), and
- the received amount is at least the order amount.

The website performs the same checks again, and an order can only become paid once. A chat
line cannot unlock two licenses.

## Testing without paying

1. Enable DonutSMP in the admin panel and set the bot username.
2. Create a test order on the checkout page and enter a username.
3. Start the bot and send the exact amount to the bot from that username.
4. Check the log for `confirmed ...` and the order changing to `paid` in
   **Admin → Payments**.

If the server does not show incoming payments in public chat, the bot cannot see them. In
that case use the admin **Approve** button for the order, or add a chat pattern that matches
the message the server actually sends. Do not use a bot account that violates DonutSMP's
rules; check the server rules before running an automated account.
