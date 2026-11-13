# Vercel + Supabase configuration for Champ Client

The website repository is `ingmarltd11-cyber/champ-site`; Vercel is expected to deploy its `main` branch. Keep the Vercel project root set to the repository root (the repo itself contains `api/`, `public/`, and `vercel.json`). Do not paste access tokens or service keys into chat or commit them to GitHub.

## Vercel project and environment variables

In the Champ Site project on Vercel, set the following under **Settings → Environment Variables** for Production (and Preview if you test preview deployments):

- `SITE_URL` — the canonical HTTPS website URL, without a trailing slash.
- `SUPABASE_URL` — URL of the Supabase project named Champclient.
- `SUPABASE_SERVICE_KEY` — the Supabase server-side secret/service-role key; never expose it in frontend code. `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SECRET_KEY` are accepted as fallbacks.
- `JWT_SECRET` — a random secret with at least 32 characters.
- `RESEND_API_KEY` — Resend API key authorized to send from the verified sender domain.
- `FROM_EMAIL` — e.g. `Champ Client <verify@your-verified-domain>`.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` — optional break-glass admin credentials for the normal login form; use a unique, strong password. Normal admin accounts are users with `is_admin = true` and sign in on `login.html`.
- `DONUT_BOT_TOKEN` only if you choose the optional DonutSMP bot mode. Manual DonutSMP review needs
  no bot or extra host. Crypto, DonutSMP and gift-card settings live in the admin panel.

### The Supabase key must be a server key

Use one of these, in this order of preference:

- a **secret key** (`sb_secret_...`) from **Supabase → Project Settings → API Keys → Secret keys**, or
- the **legacy `service_role` key** (Project Settings → API Keys → Legacy API keys).

Do **not** use the publishable key (`sb_publishable_...`) or the legacy `anon` key. Every table has RLS enabled without policies, so a public key reads nothing and cannot insert accounts. The site then shows signup as a 500, the features and reviews lists are empty, and login always says "Invalid username/email or password" — even for accounts that exist. `/api/health` reports the detected key kind as `database_key` (`service_role` or `secret` is correct) and `database_writable`.

After changing the variable, redeploy (or trigger a new deployment) so the serverless functions pick up the new value.

`JWT_SECRET` is equally required: signup and login refuse to run without a secret of at least 32 characters, so no account is created that cannot be signed into. `/api/health` reports `sessions: false` in that case; signup and login return a 503 with a clear message.

## Signup without email verification (current default)

Email verification is **off** by default: `EMAIL_VERIFICATION` is unset, so new accounts are active immediately and are signed in on signup. No sender domain, Resend key or SMTP credentials are needed, and the signup form goes straight to the dashboard (or to checkout when a plan was chosen). Set `EMAIL_VERIFICATION=true` only after a sender is configured; without a working sender every signup then fails with a 503 instead of creating an account that can never be activated.

With verification off, password reset by email is unavailable and returns a clear 503 — handle resets over Discord support. Existing accounts that were never verified are activated automatically on their next successful login.

Redeploy after changing environment variables. When verification is enabled, a six-digit code is sent through the backend using Resend or SMTP; it expires after 10 minutes and resend is throttled. For actual delivery, verify the sender domain in Resend and configure its required DNS records. The default `onboarding@resend.dev` sender is only suitable for limited Resend testing and is not a production sender for arbitrary customers.

### No domain? Use SMTP instead

If you do not own a domain, leave `RESEND_API_KEY` unset and configure an SMTP sender instead:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465`
- `SMTP_USER=your@gmail.com`
- `SMTP_PASS=<16-character Google App Password>` (requires 2-Step Verification)
- `SMTP_FROM=Champ Client <your@gmail.com>` (optional; defaults to `SMTP_USER`)

Gmail SMTP is suitable for low-volume verification mail but has daily sending limits and weaker deliverability than a verified domain. For a business, verify a domain with Resend or use a transactional SMTP relay with a verified single sender.

Vercel blocks outbound port 25 but allows 465 (implicit TLS) and 587 (STARTTLS), so Gmail SMTP works from a Vercel function. Verify the active transport with `/api/health`: `{"ok":true,"email":"smtp"}` means the SMTP variables were picked up, `"resend"` means `RESEND_API_KEY` wins, and `"none"` means verification mail cannot be sent yet.

## Support and Discord linking

The AI support assistant has been removed from both the site and the Discord bot. Support runs through
the Discord ticket system and the site dashboard. Mentioning the bot gives the dashboard, ticket and
Discord links; it does not call an AI provider.

The dashboard can link a customer to Discord in two ways: an OAuth app configured with
`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, or an 8-character, 10-minute code when the Discord bot
is configured. The member runs `/link code:<code>`; the bot proves the Discord id and the site stores
it on that customer. An active license assigns the Champ+ role automatically.

The bot and the site accept the same values under either name: `DISCORD_TOKEN` or
`DISCORD_BOT_TOKEN` for the bot token, `CLIENT_ID` or `DISCORD_CLIENT_ID` for the application id, and
`GUILD_ID` or `DISCORD_GUILD_ID` for the server. Set one token on both Railway and Vercel; the site
uses `CHAMP_PLUS_ROLE_ID` for the role itself. `/api/health` returns a `discord` block with booleans
for `oauth`, `bot`, `guild`, `role`, `schema` and `linking`, so a missing variable or unapplied
migration is visible without exposing any value.

## Supabase database

Connected Supabase project: **Champclient** (`ykmhjkkkskqyvdphzmkw`, `eu-west-1`). The website uses the service key server-side through PostgREST and Storage. Apply `supabase/schema.sql` when setting up the full website schema. Do not run the legacy instructions for creating a new Supabase project or for the Discord bot schema against this site project.

The private texture-pack table and bucket are included in `supabase/schema.sql`. Apply the latest
schema once so the Discord link-code columns exist on `public.users`.

## Verification checklist

1. Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `JWT_SECRET` are set for the environment currently deployed.
2. Open `/api/health` and confirm it returns `{"ok":true}` with `"database":true`. A deployment that reports `"database":false` is missing `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` in that environment; check the Preview/Production boxes when adding them.
3. Check `/api/health` and confirm the database and mail diagnostics look correct.
4. Create an account on `/signup.html` and confirm you land signed in (dashboard, or checkout when a plan was chosen).
5. Open the dashboard Discord tab, generate a link code and finish `/link code:<code>` in Discord.
6. Test the crypto checkout, gift-card review and manual DonutSMP review against a staging order before enabling live payments.
7. Never log or share passwords, API keys or Supabase service keys.
8. The Discord bot does not use an AI service. Generate a link code, run `/link code:<code>` and
   confirm the dashboard shows the linked Discord username. Check `/welcome setup` or
   `/welcome channel` and `/welcome preview` for the welcome flow.

Vercel CLI authentication on this workstation was not available during setup. To connect the CLI persistently, install Vercel CLI and run `vercel login` in a terminal where you can complete the browser sign-in; then link the project with `vercel link`. This does not require sharing a token in chat. GitHub deployments normally trigger Vercel automatically when the Git integration is connected to this repository.

### Vercel first-time connection (optional)

If the Vercel project is not already linked to GitHub, import `ingmarltd11-cyber/champ-site` from the Vercel dashboard, select **Other** as Framework Preset if asked (this is a FastAPI API function plus static HTML, not a Next.js app), leave `vercel.json` in effect, set the root directory to the repository root, and add the environment variables above. Once linked, new commits to `main` deploy automatically.
