# Champ Client — live zetten (Vercel + Supabase + betalingen + Resend)

Volgorde: **Supabase → betalingen → Resend → Vercel → bot → testen.**
Alles wat je in Vercel moet invullen staat in `.env.example`.

Mapstructuur: `public/` = de website (HTML, `main.js`, `style.css`, `assets/`), `api/` = de backend,
`supabase/` = de database. Wil je iets aan de site aanpassen? Dat staat allemaal in `public/`.

---

## 1. Supabase (database)
1. Maak een project op supabase.com.
2. **SQL Editor → New query** → plak de inhoud van `supabase/schema.sql` → **Run**.
   (Maakt de tabellen aan.)
2. **Storage**: er is geen bucket met jars meer nodig. De enige Windows-download is
   `public/downloads/champ.bat` + `public/downloads/champ.exe`, de injector met de client erin; die
   zitten in de deployment zelf, dus uploaden naar Supabase hoeft niet. De bucket `downloads` mag je
   leeg laten of verwijderen.
3. **Project Settings → API**: kopieer
   - Project URL → `SUPABASE_URL`
   - de **secret / service_role key** → `SUPABASE_SERVICE_KEY` (NOOIT de publieke/anon key, en nooit in je frontend zetten)

## 2. Betalingen

De checkout is één hub met drie methodes. Beheer ze in **Admin → Payments**.

### Crypto
1. Zet een walletadres en de koers **EUR per 1 coin** in **Admin → Payments**.
2. Kies BTC voor automatische controle via Blockstream (geen API-key nodig), of LTC/ETH voor
   controle door de admin.
3. De klant ziet het exacte coinbedrag en het adres. Na betalen plakt hij de txid; BTC wordt
   automatisch gecontroleerd, andere coins komen in de reviewwachtrij.

### DonutSMP money
1. Zet de botnaam en de koers **Donut money per EUR 1** in **Admin → Payments**. Je kunt per plan
   ook een **exact Donut-bedrag** vastzetten; dat bedrag controleert de bot dan, ongeacht de koers.
2. Deploy `donut-bot/` als aparte 24/7-service (Railway of een VPS) en zet daar dezelfde
   `DONUT_BOT_TOKEN` als in Vercel. Zie `donut-bot/README.md`.
3. De klant voert zijn Minecraft-username in en betaalt het exacte bedrag aan de bot. De bot
   leest de betaling in chat en stuurt een bevestiging naar de site.

### Cadeaubonnen
1. Zet de merken en de instructie in **Admin → Payments**.
2. De klant kiest een merk, vult de waarde en de code in. De code wordt opgeslagen voor
   handmatige controle; dezelfde code kan niet twee keer worden ingediend.
3. De order komt in **Admin → Payments → Waiting for review**. Klopt de code, dan keur je
   hem goed en wordt de licentie direct aangemaakt. Is de code al gebruikt, dan afkeuren met
   als reden “Gift card code is used”; de klant krijgt die melding.

Er is geen algemene publieke API waarmee je elke cadeaubon automatisch kunt valideren. Daarom
is dit bewust een beveiligde handmatige controle in plaats van een pseudo-check.

### Belangrijk
- Zet geen betaalgeheimen in de frontend of in de database.
- Draai `supabase/schema.sql` opnieuw: het voegt de betaalkolommen toe en verwijdert de oude
  providerkolommen en -tabel.

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
5. Zet de betaalinstellingen in **Admin → Payments**. Zonder wallet/bot blijven crypto en
   DonutSMP uit; cadeaubonnen hebben alleen de merken en instructie nodig.
6. Aanrader: **Firewall → rate limit** op `/api/auth/*` en `/api/request-payment-link` (beschikbaarheid
   hangt van je Vercel-plan af).

## 5. Testen
- [ ] `https://JOUW-DOMEIN/api/health` geeft `{"ok":true}`
- [ ] Account maken → mail ontvangen → verifiëren → inloggen
- [ ] Wachtwoord vergeten → mail → nieuw wachtwoord
- [ ] Plan kiezen op de homepage → mail met betaallink → inloggen → checkout
- [ ] Dashboard toont licentiesleutel + download werkt
- [ ] Crypto-order maakt een adres en coinbedrag; txid invullen geeft de juiste status
- [ ] DonutSMP-order verschijnt bij de bot en de bot kan hem bevestigen
- [ ] Cadeaubon komt in de reviewwachtrij; goedkeuren geeft een licentie, afkeuren geeft “code is used”
- [ ] Monthly pass → dashboard toont een 30-dagenvervaldatum; er is geen automatische verlenging

---

## Hoe het werkt
- Betalen → blockchain/bot/admin bevestigt → licentie wordt aangemaakt → mail met sleutel → dashboard toont download.
- Downloads gaan via een **signed URL die 60 seconden geldig is**, alleen voor ingelogde gebruikers met een actieve licentie.
- Weekly: eenmalige betaling voor 7 dagen; daarna stopt de toegang, zonder automatische verlenging.
- Monthly: eenmalige betaling voor 30 dagen; daarna stopt de toegang, zonder automatische verlenging.
- Lifetime: bij een terugbetaling of geschil kan een admin de licentie intrekken via **Admin → Licenses**.

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

Buy Monthly/Lifetime now sends the visitor to `signup.html?plan=...`. Registration requires a matching email twice and a matching password twice. A 6-digit code is sent through Resend and expires after 10 minutes. `verify.html` supports resend and changing the email address. After successful verification, the backend creates the existing `pending_payments` checkout record and redirects to the payment hub.

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

### Payment plans
The site sells three products plus a free trial:

- `trial` — free, 24 hours, once per account, PC and network
- `weekly` — €2.99 one-time, 7 days
- `monthly` — €6.99 one-time, 30 dagen
- `lifetime` — €9.99 one-time

The `inject`, `mod10` and `mod5` plans have been removed entirely.

Prices live in `PLAN_PRICES` in `api/index.py`; the payment methods are configured in the admin panel.

### Supabase
Run the complete `supabase/schema.sql` again. It now also creates/seeds the `features` table.

It also repairs the `plan_type` check on `pending_payments` and `licenses`. Run it once on your
existing project (it is safe to run repeatedly, unless your database still contains `inject`
licenses — delete or migrate those rows first, otherwise the tightened check fails).

For an existing project that already has the weekly plan, also run `supabase/trial-migration.sql`
once in the SQL Editor. It allows the `trial` plan and adds `trial_ip` plus the two partial unique
indexes behind the one-trial-per-network and one-trial-per-PC rules. There is
nothing to upload: the Windows pair (`public/downloads/champ.bat` + `public/downloads/champ.exe`)
ships with the deployment.

### Free-trial VPN check

The trial calls proxycheck.io before a key is issued and again when the key first binds to a PC.
VPN, proxy, Tor and hosting/datacenter addresses are refused. Without a key the endpoint uses the
unregistered limit of 100 checks per day; create a free account and set `PROXYCHECK_API_KEY` in
Vercel for 1,000 per day. If the check cannot be completed, the trial is refused rather than issued
unchecked, so a provider outage pauses new trials without touching paid licenses.
