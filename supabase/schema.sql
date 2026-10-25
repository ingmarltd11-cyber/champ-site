-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists public.users (
  id              bigint generated always as identity primary key,
  username        text not null,
  username_lower  text not null unique,
  email           text not null unique,
  password_hash   text not null,
  email_verified  boolean not null default false,
  last_email_at   timestamptz,
  verification_code_hash text,
  verification_code_expires_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.users add column if not exists verification_code_hash text;
alter table public.users add column if not exists verification_code_expires_at timestamptz;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists totp_secret text;
alter table public.users add column if not exists totp_enabled boolean not null default false;
alter table public.users add column if not exists discord_id text;
alter table public.users add column if not exists discord_username text;
alter table public.users add column if not exists is_admin boolean not null default false;

create table if not exists public.pending_payments (
  uid         uuid primary key,
  email       text not null,
  plan_type   text not null check (plan_type in ('monthly', 'lifetime')),
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists pending_payments_email_idx on public.pending_payments (email, created_at desc);

create table if not exists public.licenses (
  id                      bigint generated always as identity primary key,
  email                   text not null,
  plan_type               text not null check (plan_type in ('monthly', 'lifetime')),
  license_key             text not null unique,
  status                  text not null default 'active',
  expires_at              timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  stripe_payment_intent   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (email, plan_type)
);
create index if not exists licenses_sub_idx on public.licenses (stripe_subscription_id);
create index if not exists licenses_pi_idx  on public.licenses (stripe_payment_intent);
alter table public.licenses add column if not exists redeemed_at timestamptz;

-- Hardware binding: one PC per key. The loader sends a hashed hardware ID and the key is bound to
-- the first one that uses it. A reset clears the binding, so the same key can move to a new PC.
alter table public.licenses add column if not exists hwid text not null default '';
alter table public.licenses add column if not exists hwid_bound_at timestamptz;
alter table public.licenses add column if not exists hwid_reset_at timestamptz;
create index if not exists licenses_hwid_idx on public.licenses (hwid);

-- Device identity: the client generates an Ed25519 key pair on the PC and only the public key
-- leaves it. The server pins that key to the license, so a copied JAR or config on another PC
-- cannot sign the licence challenge. A reset clears the pinned key together with the HWID.
alter table public.licenses add column if not exists device_pubkey text not null default '';
alter table public.licenses add column if not exists device_key_bound_at timestamptz;

-- Last online check, for support and for spotting a key that is used from two places at once.
alter table public.licenses add column if not exists last_ip text not null default '';
alter table public.licenses add column if not exists last_seen_at timestamptz;

-- Every reset is kept, so support can see how often a key moved and which resets were paid.
create table if not exists public.hwid_resets (
  id             bigint generated always as identity primary key,
  license_id     bigint not null,
  license_key    text not null,
  old_hwid       text not null default '',
  reason         text not null default 'free' check (reason in ('free', 'paid', 'admin')),
  payment_intent text,
  created_at     timestamptz not null default now()
);
create index if not exists hwid_resets_license_idx on public.hwid_resets (license_id, created_at desc);
alter table public.hwid_resets enable row level security;

alter table public.pending_payments add column if not exists referral_code text;

-- Referrals: users earn 10% credit for sales through their personal link.
create table if not exists public.referrals (
  code          text primary key,
  owner_email   text not null unique,
  earnings_cents integer not null default 0,
  paid_cents    integer not null default 0,
  created_at    timestamptz not null default now()
);
create table if not exists public.referral_uses (
  id            bigint generated always as identity primary key,
  code          text not null,
  email         text not null,
  plan          text not null,
  amount_cents  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists referral_uses_code_idx on public.referral_uses (code, created_at desc);

-- Base finds: community gallery with description + image.
create table if not exists public.base_finds (
  id            bigint generated always as identity primary key,
  user_email    text not null,
  username      text not null,
  title         text not null,
  description   text not null default '',
  image_path    text,
  status        text not null default 'pending',
  created_at    timestamptz not null default now()
);
create index if not exists base_finds_status_idx on public.base_finds (status, created_at desc);

create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  created_at  timestamptz not null default now()
);

-- Site Settings (announcements, links, showcase videos, etc.)
create table if not exists public.site_settings (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

-- Features (managed in admin panel with video/description)
create table if not exists public.features (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  video_url text not null default '',
  image_url text not null default '',
  category text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.features add column if not exists image_url text not null default '';
alter table public.features add column if not exists category text not null default '';
create table if not exists public.ai_knowledge (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Client JAR files uploaded by an admin (one active file per plan).
create table if not exists public.download_files (
  plan         text primary key check (plan in ('monthly', 'lifetime')),
  storage_path text not null,
  filename     text not null,
  size_bytes   bigint not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.download_files enable row level security;

-- Public changelog, written from the admin panel.
create table if not exists public.changelog (
  id bigint generated always as identity primary key,
  version text not null,
  title text not null,
  body text not null default '',
  released_at date not null default current_date,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists changelog_released_idx on public.changelog (published, released_at desc);
alter table public.changelog enable row level security;

-- Shared multi-turn support history for website and Discord conversations.
create table if not exists public.ai_conversations (
  session_id text primary key,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
-- Allow browser-based support sessions to persist multi-turn messages.
create table if not exists public.website_ai_conversations (
  session_id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ai_conversations enable row level security;
alter table public.website_ai_conversations enable row level security;

-- Reviews (managed or approved in admin panel)
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  author text not null,
  rating integer not null default 5,
  text text not null,
  tag text not null default 'Verified Member',
  status text not null default 'approved',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists reviews_status_idx on public.reviews (status, sort_order asc);

-- Texture packs (for all visitors or customers only)
create table if not exists public.texture_packs (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  download_url text not null default '',
  storage_path text,
  category text not null default 'PvP',
  is_customer_only boolean not null default false,
  image_url text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.texture_packs add column if not exists storage_path text;
alter table public.texture_packs alter column download_url set default '';
alter table public.texture_packs enable row level security;

-- Allow plans
alter table public.pending_payments drop constraint if exists pending_payments_plan_type_check;
alter table public.pending_payments add constraint pending_payments_plan_type_check
  check (plan_type in ('monthly', 'lifetime'));

alter table public.licenses drop constraint if exists licenses_plan_type_check;
alter table public.licenses add constraint licenses_plan_type_check
  check (plan_type in ('monthly', 'lifetime'));

-- Lock tables: service key access
alter table public.users            enable row level security;
alter table public.pending_payments enable row level security;
alter table public.licenses         enable row level security;
alter table public.stripe_events    enable row level security;
alter table public.referrals        enable row level security;
alter table public.referral_uses    enable row level security;
alter table public.base_finds       enable row level security;
alter table public.features         enable row level security;
alter table public.site_settings    enable row level security;
alter table public.reviews          enable row level security;
alter table public.texture_packs    enable row level security;
alter table public.ai_knowledge     enable row level security;
alter table public.download_files   enable row level security;
alter table public.changelog        enable row level security;

-- Storage buckets
insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('base-finds', 'base-finds', false)
on conflict (id) do nothing;
update storage.buckets set public = false where id = 'base-finds';

insert into storage.buckets (id, name, public)
values ('texture-packs', 'texture-packs', false)
on conflict (id) do nothing;
update storage.buckets set public = false where id = 'texture-packs';

-- Public screenshots for the features page and texture pack previews.
insert into storage.buckets (id, name, public)
values ('site-media', 'site-media', true)
on conflict (id) do update set public = true;

-- Features are not seeded here on purpose: public/feature-catalog.js is the source of truth
-- for every module on the Features page, and this table only stores what an admin adds on top
-- of it (per-module screenshot, video, description, sort order, or a custom entry).
-- Remove the generic category rows that older versions of this file seeded; they are not
-- modules, so they used to show up as duplicate "More" cards next to the real ones.
delete from public.features
where slug in ('fabric-mod', 'combat', 'movement', 'render', 'donut')
  and category = '';

-- Default settings
insert into public.site_settings (key, value)
values
  ('announcement_text', '🔥 Champ Client 0.9.9.1 is out for Minecraft 1.21.11 Fabric Loader! Get Lifetime for €9.99 or Monthly for €6.99.'),
  ('announcement_enabled', 'true'),
  ('discord_link', 'https://discord.gg/6vyQnVjeX'),
  ('youtube_video_url', ''),
  ('hero_tagline', 'The Ultimate Minecraft 1.21.11 Fabric Mod')
on conflict (key) do nothing;

-- Default reviews
insert into public.reviews (author, rating, text, tag, status, sort_order)
values
  ('VortexPvP', 5, 'Best client mod I have used for 1.21.11. The Fabric integration is butter smooth and crystal PvP is instant.', 'Verified Buyer', 'approved', 1),
  ('Kxng_Shadow', 5, 'Lifetime for 9.99 is insane value. Base finder and anchor macro worked immediately without any lag or frame drops.', 'Lifetime Member', 'approved', 2),
  ('DonutGrinder99', 5, 'Been using it on DonutSMP for weeks. Auto totems and AH sniper are unbeatable.', 'Verified Buyer', 'approved', 3),
  ('EliteCrafter', 5, 'The new UI is super clean and being a mod means you just put it in the mods folder. 10/10.', 'Verified Buyer', 'approved', 4)
on conflict do nothing;

-- Default texture packs
insert into public.ai_knowledge (title, body)
values
  ('Product, plans, installation, accounts, customer support', 'Champ Client is a Minecraft Java Fabric mod for Minecraft 1.21.11, installed as a .jar in the mods folder alongside Fabric Loader (not an injection tool). Plans: EUR 9.99 lifetime and EUR 6.99 monthly. Customers register with username, password, and email, then verify a 6-digit email code valid for 10 minutes; the email provider must be configured on Vercel before sending works. Purchases use Stripe Checkout, licenses are assigned by a Stripe webhook, downloads are authorized from the customer dashboard. Texture packs are public or customer-only. Site administration can manage announcements, Discord links, homepage and feature videos, features, reviews, texture pack files, orders, referrals and community finds. Only report facts confirmed by current records/site; do not invent features, user reviews, downloads, compatibility, guarantees or legal claims. If a detail is not found in the knowledge, say you do not have verified information and direct to the support link. Never disclose or request credentials, license keys or private account data.'),
  ('Installation', 'Install Fabric Loader for Minecraft 1.21.11, then place the Champ loader JAR from the customer dashboard in the Minecraft mods folder and launch that Fabric profile. Customers download Champ Loader (stable) or Champ Beta, not a separate client JAR: the client travels inside the loader. On the first launch the loader fetches the current client build, after which Minecraft should be closed fully and started once more. Ensure required dependencies listed with the current release are installed. Do not claim support for other Minecraft versions unless documented by the current release notes.'),
  ('Loaders: Champ Loader and Champ Beta', 'Two loaders ship from the dashboard: Champ Loader (stable) and Champ Beta (its own update channel, for testing beta builds). Exactly one of them may sit in the mods folder; the loader that starts removes the other one automatically and tells the player to delete it by hand when Windows keeps the file locked. Both loaders update themselves and the client automatically, so a new build never means downloading a new jar. The client is nested inside the loader and never appears in mods.'),
  ('Licence keys by e-mail', 'Every purchase, and every key that support hands out or edits, is e-mailed automatically to the customer address with the key in the message plus a thank-you note; the same key is shown in the customer dashboard. Keys look like CHAMP-XXXX-XXXX-XXXX-XXXX. Never ask a customer to post a key in chat and never repeat a key back.'),
  ('Billing', 'The site lists EUR 9.99 lifetime (one-time) and EUR 6.99 monthly. Monthly plans can be managed/cancelled through the customer dashboard when billing is configured. Support handles purchase and account problems.')
on conflict do nothing;
