# Champ Client — live zetten (Vercel + Supabase + SellAuth + Resend)

Volgorde: **Supabase → SellAuth → Resend → Vercel → testen.**
Alle variabelen staan in `.env.example`.

Mapstructuur: `public/` = website, `api/` = backend, `supabase/` = database.

---

## 1. Supabase (database)

1. Maak een project op supabase.com.
2. **SQL Editor → New query** → plak `supabase/schema.sql` → **Run**.
3. **Project Settings → API**: kopieer
   - Project URL → `SUPABASE_URL`
   - de **secret / service_role key** → `SUPABASE_SERVICE_KEY` (nooit de publieke key)

De bestaande `licenses`-rijen en keys blijven staan. De oude Stripe-kolommen zijn alleen nog
historische opslag; de nieuwe SellAuth-referentie gebruikt dezelfde kolom voor idempotency.

## 2. SellAuth (betalingen)

1. Maak een shop op [sellauth.com](https://sellauth.com/) en kies je payment methods
   (bijv. PayPal en crypto; je hoeft geen Stripe te koppelen).
2. Maak drie producten of één product met drie varianten:
   - **Weekly** — €2.99, 7 dagen, eenmalig
   - **Monthly** — €6.99, 30 dagen, eenmalig (geen abonnement)
   - **Lifetime** — €9.99, eenmalig
3. Zet de delivery van elke variant op **Dynamic** en vul als delivery-URL:
   `https://JOUW-DOMEIN/api/sellauth-webhook`
4. Optioneel: maak een vierde product **HWID reset** van €5 met dezelfde dynamic URL.
   Zonder dit product geeft de betaalde reset een nette 503; de gratis reset blijft werken.
5. Kopieer per variant de **product ID** en **variant ID** naar de Vercel-variabelen.
6. Ga naar **Developers → Overview** en kopieer de **webhook secret** naar
   `SELLAUTH_WEBHOOK_SECRET`. Zet de secret nooit in de site of in git.

De webhook is ondertekend met HMAC-SHA256 over de ruwe body in `X-Signature`. De backend
weigert een ongeldige handtekening, maakt één Champ-key per item en geeft bij een retry
dezelfde key terug. SellAuth toont die key op de betaalpagina en Champ mailt hem ook.

## 3. Resend (e-mail)

1. Voeg je domein toe en zet de DNS-records.
2. Maak een API key → `RESEND_API_KEY`.
3. `FROM_EMAIL` = bijv. `Champ Client <noreply@jouw-domein.com>`.

Zonder eigen domein kun je alleen naar je eigen adres mailen; zet dan `EMAIL_VERIFICATION=false`
en gebruik de Gmail-SMTP-fallback uit `.env.example`.

## 4. Vercel

1. Importeer de repo; `vercel.json` regelt de static site en `/api/*`.
2. Zet alle waarden uit `.env.example` in **Settings → Environment Variables**.
   `JWT_SECRET` maak je met:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   `SITE_URL` = je echte domein, met https en zonder `/` erachter.
3. Deploy en zet daarna je domein goed; redeploy als `SITE_URL` wijzigt.
4. Rate-limit aanraden: `/api/auth/*`, `/api/start-checkout` en `/api/sellauth-webhook`.

## 5. Testen

- [ ] `https://JOUW-DOMEIN/api/health` geeft `{"ok":true}` en `sellauth.checkout_ready=true`.
- [ ] Account maken → inloggen → plan kiezen → je gaat naar de SellAuth-checkout.
- [ ] Testbetaling doen; SellAuth toont de Champ-key en de webhook geeft HTTP 200.
- [ ] Dashboard toont de key en de download werkt.
- [ ] Dezelfde delivery nog eens afvuren geeft dezelfde key (geen tweede licentie).
- [ ] Betaalde HWID-reset (als ingericht) reset het apparaat en niet de licentie.
- [ ] Daarna live payment methods en echte prijzen gebruiken.

## Hoe het werkt

- SellAuth verwerkt de betaling en stuurt per item een ondertekende dynamic-delivery POST.
- De backend maakt of verlengt de licentie in Supabase en antwoordt met de key als platte tekst.
- Weekly = 7 dagen, Monthly = 30 dagen, Lifetime = geen vervaldatum.
- Een bestaande actieve key van dezelfde plan wordt verlengd vanaf de huidige einddatum.
- De client en HWID-binding blijven ongewijzigd; alleen de betaalprovider is vervangen.

## Belangrijk

- De injector is een statisch bestand; de licentie wordt bij elke start via
  `POST /api/license/session` gecontroleerd.
- Terms of Service en Privacy Policy zijn sjablonen: laat ze juridisch controleren.
- Lokaal testen kan met `vercel dev` en `DEV_MODE=true`.
- SellAuth kan kaartbetalingen via een eigen gateway laten lopen; je integreert zelf geen Stripe.
  Als je helemaal geen Stripe-verwerking wilt, zet in SellAuth alleen PayPal en crypto aan.
