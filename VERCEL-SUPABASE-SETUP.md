# Vercel + Supabase koppelen met champclient1@gmail.com

Je vroeg om te connecten met **champclient1@gmail.com** (user `@Mangercats121011`) voor Vercel en Supabase.
Ik kan niet met alleen e-mail + wachtwoord inloggen — Vercel en Supabase werken met tokens/keys.
Doe deze 2x eenmalige stappen (5 min), plak de keys terug in de chat, dan maak ik de koppeling af.

## 1. Vercel — account champclient1@gmail.com

1. Log in op Vercel met `champclient1@gmail.com`
2. Ga naar **Settings → Tokens** → **Create Token** (noem hem `champ-client`)
3. Kopieer de `VERCEL_TOKEN` ( begint met `vercel_...` )
4. Ga naar **Dashboard → Add New → Project → Import** je `website/` repo
   - Framework: **Next.js** (staat al in `website/vercel.json`)
   - Root Directory: `website`
   - Voeg Environment Variables toe uit `website/.env.example`
5. Plak hier in de chat: `VERCEL_TOKEN=...`

Met die token kan ik voor je doen: `vercel link`, `vercel env add`, `vercel --prod`.

## 2. Supabase — zelfde Gmail-account

Supabase zit niet in de automatische catalogus, dus handmatig (eenmalig):

1. Log in op https://supabase.com met `champclient1@gmail.com`
2. **New Project** → naam `champ-client` → regio `West EU (Ireland)` → DB password genereren
3. Wacht tot de project klaar is → **Project Settings → API**:
   - kopieer `Project URL` (= `SUPABASE_URL`)
   - kopieer `anon public` (= `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - kopieer `service_role` (= `SUPABASE_SERVICE_KEY`, hou geheim!)
4. Ga naar **SQL Editor → New Query** → plak alles uit `discord bot/supabase/schema.sql` → **Run**
   - Dit maakt `tickets` + `licenses` aan (RLS aan, alleen service_role heeft toegang)
5. Plak hier in de chat:
```
SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

## 3. Wat ik daarna automatisch doe

- Zet de keys in `discord bot/.env` (bot) en Vercel Env Vars (website)
- Test: `node -e "require('./src/utils/supabase.js')"` + Supabase query op `tickets`
- Deploy website naar Vercel preview: `vercel --prod` (na `npm run build` lokaal)
- Bot blijft op Railway/Render draaien (Vercel kan geen Discord-bot hosten — alleen website)

> Veiligheid: deel nooit je wachtwoord `Mangercats...` in de chat. Alleen tokens/keys. Wachtwoorden heb ik niet nodig.
