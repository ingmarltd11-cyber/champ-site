# Champ Client — live zetten (Vercel + Supabase + Stripe + Resend)

Volgorde: **Supabase → Stripe → Resend → Vercel → testen.**
Alles wat je in Vercel moet invullen staat in `.env.example`.

Mapstructuur: `public/` = de website (HTML, `main.js`, `style.css`, `assets/`), `api/` = de backend,
`supabase/` = de database. Wil je iets aan de site aanpassen? Dat staat allemaal in `public/`.

---

## 1. Supabase (database)
1. Maak een project op supabase.com.
2. **SQL Editor → New query** → plak de inhoud van `supabase/schema.sql` → **Run**.
   (Maakt de tabellen aan.)
3. **Storage**: er is geen bucket met jars meer nodig. De enige download is `public/downloads/champ-client.exe`,
   de injector met de client erin; die zit in de deployment zelf, dus uploaden naar Supabase hoeft niet.
   De bucket `downloads` mag je leeg laten of verwijderen.
4. **Project Settings → API**: kopieer
   - Project URL → `SUPABASE_URL`
   - de **secret / service_role key** → `SUPABASE_SERVICE_KEY` (NOOIT de publieke/anon key, en nooit in je frontend zetten)

## 2. Stripe (betalingen)
1. **Product catalog** → maak 2 producten:
   - *Monthly*: **Recurring**, maandelijks, jouw prijs → kopieer Price ID (`price_...`) → `STRIPE_PRICE_MONTHLY_ID`
   - *Lifetime*: **One-time**, jouw prijs → `STRIPE_PRICE_LIFETIME_ID`
   Zorg dat de prijzen kloppen met wat op je site staat.
2. **Developers → API keys** → secret key → `STRIPE_SECRET_KEY` (begin met `sk_test_...` om te testen).
3. **Settings → Billing → Customer portal** → activeren en "Cancel subscriptions" aanzetten
   (anders werkt de knop *Manage subscription* niet).
4. **Webhook** (doe dit NA de Vercel-deploy, je hebt je domein nodig):
   **Developers → Webhooks → Add endpoint**
   - URL: `https://JOUW-DOMEIN/api/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`,
     `charge.refunded`, `charge.dispute.created`
   - Kopieer de *Signing secret* (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`
5. **Settings → Payment methods**: zet aan wat je wilt (kaart, iDEAL, Apple Pay...). Checkout toont
   automatisch wat past bij land/valuta. Crypto en PayPal-knoppen zijn van de site gehaald: Stripe
   ondersteunt crypto niet in Checkout.
6. LET OP: Stripe heeft een lijst met verboden bedrijfstypes en game-cheat software kan daar onder
   vallen. Lees hun beleid, anders riskeer je een bevroren account met vastgehouden geld.

## 3. Resend (e-mail: verificatie, reset, betaallink, licentie)
1. resend.com → **Domains** → voeg je domein toe en zet de DNS-records (zonder eigen domein kun je
   alleen naar je eigen mailadres sturen).
2. **API Keys** → maak een key → `RESEND_API_KEY`
3. `FROM_EMAIL` = bijv. `Champ Client <noreply@jouw-domein.com>`

## 4. Vercel (hosting)
1. Zet deze map in een GitHub-repo (`.env` staat in `.gitignore`, maar commit nooit geheimen).
2. vercel.com → **Add New → Project** → importeer de repo. Laat Framework Preset en de rest op standaard staan:
   `vercel.json` zet alles goed (geen build command, de site komt uit `public/`, de API uit `api/`).
   Zie je bij de preset toch "FastAPI", dan maakt dat niet uit.
3. **Settings → Environment Variables**: vul alles uit `.env.example` in. `JWT_SECRET` maak je met:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   `SITE_URL` = je echte domein (met https, zonder `/` erachter).
4. Deploy. Voeg daarna je domein toe onder **Settings → Domains**, zet `SITE_URL` goed en **redeploy**.
5. Doe nu stap 2.4 (Stripe webhook) en zet de `whsec_...` in Vercel → **redeploy** nog een keer.
6. Aanrader: **Firewall → rate limit** op `/api/auth/*` en `/api/request-payment-link` (beschikbaarheid
   hangt van je Vercel-plan af).

## 5. Testen (eerst met Stripe TEST-keys)
- [ ] `https://JOUW-DOMEIN/api/health` geeft `{"ok":true}`
- [ ] Account maken → mail ontvangen → verifiëren → inloggen
- [ ] Wachtwoord vergeten → mail → nieuw wachtwoord
- [ ] Plan kiezen op de homepage → mail met betaallink → inloggen → checkout
- [ ] Betalen met testkaart `4242 4242 4242 4242` (willekeurige toekomstige datum + CVC)
- [ ] Dashboard toont licentiesleutel + download werkt (Stripe → Webhooks toont dan 200 OK)
- [ ] *Manage subscription* → opzeggen → licentie verloopt aan het einde van de periode
- [ ] Daarna: live keys (`sk_live_...`, live prijzen, live webhook) invullen en opnieuw deployen

---

## Hoe het werkt
- Betalen → Stripe stuurt een webhook → licentie wordt aangemaakt → mail met sleutel → dashboard toont download.
- Downloads gaan via een **signed URL die 60 seconden geldig is**, alleen voor ingelogde gebruikers met een actieve licentie.
- Monthly: toegang loopt door tot het einde van de betaalde periode (+24 uur marge). Opzeggen of niet betalen = toegang stopt.
- Lifetime: bij volledige terugbetaling of dispute wordt de licentie automatisch ingetrokken.
  Bij monthly-refunds: zeg het abonnement zelf op in Stripe.

## Belangrijk om te weten
- De injector is een statisch bestand: wie 'm eenmaal gedownload heeft, kan 'm blijven gebruiken.
  De licentie wordt bij elke start gecontroleerd via `POST /api/license/validate` met
  `{"key": "CHAMP-XXXX-XXXX-XXXX-XXXX"}` → antwoord `{"valid": true/false, "plan": ..., "expires_at": ...}`.
- Terms of Service en Privacy Policy zijn sjablonen: lees ze door, pas ze aan en laat ze zo mogelijk
  door iemand met verstand van zaken checken (o.a. consumentenrechten/herroepingsrecht bij digitale producten,
  btw en bedrijfsgegevens).
- Lokaal testen kan met `vercel dev` en `DEV_MODE=true` (mails worden dan niet echt verstuurd,
  de betaallink staat in de browserconsole).


## New registration + verification flow

Buy Monthly/Lifetime now sends the visitor to `signup.html?plan=...`. Registration requires a matching email twice and a matching password twice. A 6-digit code is sent through Resend and expires after 10 minutes. `verify.html` supports resend and changing the email address. After successful verification, the backend creates the existing `pending_payments` checkout record and redirects to the current Stripe checkout page.

Run the updated `supabase/schema.sql` once to add the verification-code columns. Existing rows are preserved.

## New site customization

### Theme
The site now uses a purple / deep-blue theme and `html { scroll-behavior: smooth; }` for smooth anchor scrolling.

### Features page
Open `/features.html`. Feature cards are loaded from the Supabase `features` table.

### Admin panel
Sign in on `/login.html`. Accounts with `is_admin = true` land straight in `/admin.html`; the admin page no longer has its own login form. A normal (non-admin) account that opens `/admin.html` sees an "Admins only" message.

Enable admin for an existing account in Supabase:

```sql
update public.users set is_admin = true where email = 'you@example.com';
```

Admins automatically receive an active lifetime license, so their own key appears under **My account** in the admin panel.

`ADMIN_USERNAME` / `ADMIN_PASSWORD` still work as a break-glass login through the normal login form; that account has no customer profile. Admin sessions are HttpOnly cookies. "Remember me" keeps the login for 30 days; without it the cookie ends when the browser closes.

Discord keys (`/key generate` in the bot) are written to the same `licenses` table and appear in **Orders & Keys**. Keys without an email show an **Unclaimed** badge until the first account redeems them.

The admin panel lets you edit each feature's:

- title
- description
- video embed URL

For YouTube, use an embed URL such as `https://www.youtube.com/embed/VIDEO_ID`.

### Stripe plans
The site sells exactly two products:

- `monthly` — €6.99 recurring — `STRIPE_PRICE_MONTHLY_ID`
- `lifetime` — €9.99 one-time — `STRIPE_PRICE_LIFETIME_ID`

The `inject`, `mod10` and `mod5` plans have been removed entirely.

Create the corresponding Stripe Prices and put their IDs into Vercel Environment Variables.

### Supabase
Run the complete `supabase/schema.sql` again. It now also creates/seeds the `features` table.

It also repairs the `plan_type` check on `pending_payments` and `licenses`. Run it once on your
existing project (it is safe to run repeatedly, unless your database still contains `inject`
licenses — delete or migrate those rows first, otherwise the tightened check fails). There is
nothing to upload: the injector (`public/downloads/champ-client.exe`) ships with the deployment.
