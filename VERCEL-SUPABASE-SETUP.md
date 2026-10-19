# Vercel + Supabase configuration for Champ Client

The website repository is `ingmarltd11-cyber/champ-site`; Vercel is expected to deploy its `main` branch. Keep the Vercel project root set to the repository root (the repo itself contains `api/`, `public/`, and `vercel.json`). Do not paste access tokens or service keys into chat or commit them to GitHub.

## Vercel project and environment variables

In the Champ Site project on Vercel, set the following under **Settings → Environment Variables** for Production (and Preview if you test preview deployments):

- `SITE_URL` — the canonical HTTPS website URL, without a trailing slash.
- `SUPABASE_URL` — URL of the Supabase project named Champclient.
- `SUPABASE_SERVICE_KEY` — the Supabase server-side secret/service-role key; never expose it in frontend code.
- `JWT_SECRET` — a random secret with at least 32 characters.
- `RESEND_API_KEY` — Resend API key authorized to send from the verified sender domain.
- `FROM_EMAIL` — e.g. `Champ Client <verify@your-verified-domain>`.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` — private admin credentials; use a unique, strong password.
- Stripe keys and price IDs from `.env.example` when enabling real checkout/webhooks.

Redeploy after changing environment variables. Email verification sends a six-digit code through the backend using Resend; it expires after 10 minutes and resend is throttled. For actual delivery, verify the sender domain in Resend and configure its required DNS records. The default `onboarding@resend.dev` sender is only suitable for limited Resend testing and is not a production sender for arbitrary customers.

## Supabase database

Connected Supabase project: **Champclient** (`ykmhjkkkskqyvdphzmkw`, `eu-west-1`). The website uses the service key server-side through PostgREST and Storage. Apply `supabase/schema.sql` when setting up the full website schema. Do not run the legacy instructions for creating a new Supabase project or for the Discord bot schema against this site project.

The `ai_knowledge` table was added to the connected project for the admin-managed assistant knowledge feature. The shared assistant conversation tables and private texture-pack table/bucket are also provisioned; they are included in `supabase/schema.sql`.

## Verification checklist

1. Confirm all required Vercel variables are set for the environment currently deployed.
2. Confirm Resend shows the sender domain as verified and `FROM_EMAIL` uses that domain.
3. Open `/api/health` and confirm it returns `{"ok":true}`.
4. Register with an address you control; check inbox and spam for the 6-digit verification code, enter it on `/verify.html`, then sign in.
5. If delivery fails, inspect the Vercel function logs and Resend email logs. Never log or share verification codes, passwords, API keys, or Supabase service keys.
6. Test Stripe using test credentials and a test webhook before switching any billing variable to live mode.
7. Set `OPENAI_API_KEY` or `GROQ_API_KEY` on Vercel to enable the interactive support assistant; add the same model provider key to the backend runtime only. The Discord bot calls `/api/ai/chat` with `channel=discord` and uses the same database-backed knowledge and per-ticket conversation history.

Vercel CLI authentication on this workstation was not available during setup. To connect the CLI persistently, install Vercel CLI and run `vercel login` in a terminal where you can complete the browser sign-in; then link the project with `vercel link`. This does not require sharing a token in chat. GitHub deployments normally trigger Vercel automatically when the Git integration is connected to this repository.

### Vercel first-time connection (optional)

If the Vercel project is not already linked to GitHub, import `ingmarltd11-cyber/champ-site` from the Vercel dashboard, select **Other** as Framework Preset if asked (this is a FastAPI API function plus static HTML, not a Next.js app), leave `vercel.json` in effect, set the root directory to the repository root, and add the environment variables above. Once linked, new commits to `main` deploy automatically.
