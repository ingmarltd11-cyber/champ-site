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
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

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
  download_url text not null,
  category text not null default 'PvP',
  is_customer_only boolean not null default false,
  image_url text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

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

-- Storage buckets
insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('base-finds', 'base-finds', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('texture-packs', 'texture-packs', true)
on conflict (id) do nothing;

-- Default features
insert into public.features (slug, title, description, video_url, sort_order)
values
  ('fabric-mod', 'Fabric Mod (Minecraft 1.21.11)', 'Native Fabric mod running directly inside Minecraft 1.21.11 with Fabric Loader. No injection needed, no external loader, and fully stable.', '', 1),
  ('combat', 'Combat & PvP Suite', 'Advanced modules including Anchor Aura, Crystal Aura, Auto Totem, Triggerbot, Shield Breaker, Aim Assist, and smooth hit registration.', '', 2),
  ('movement', 'Movement & QoL', 'Fly, Speed, Elytra Fly, Jesus, Spider, Entity Speed, Fast Bridge, and No Jump Delay engineered for high performance.', '', 3),
  ('render', 'Visuals & Render Engine', 'ImGui-powered customizable HUD, Glint Head, Borderless Fullscreen, Player ESP, Storage ESP, Tracers, and Custom Crosshair.', '', 4),
  ('donut', 'DonutSMP & Raid Tools', 'Donut NoFall, Netherite Finder, Player Detection, Player Bypass, Anti Vanish, Base Finder, and AH Sniper built-in.', '', 5)
on conflict (slug) do nothing;

-- Default settings
insert into public.site_settings (key, value)
values
  ('announcement_text', '🔥 Champ Client 0.9.9.1 is out for Minecraft 1.21.11 Fabric Loader! Get Lifetime for €9.99 or Monthly for €6.99.'),
  ('announcement_enabled', 'true'),
  ('discord_link', 'https://discord.gg/ETuFknzhy'),
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
insert into public.texture_packs (name, description, download_url, category, is_customer_only, sort_order)
values
  ('Champ 16x Dark PvP', 'Clean short swords, dark GUI, visible low-fire and highlighted ores. Perfect for any Fabric PvP setup.', 'https://github.com/4ldenz/Champ-client', 'PvP', false, 1),
  ('Champ Faithful Edit 32x', 'Enhanced faithful textures with smooth armor models, clear water, and custom totem pops.', 'https://github.com/4ldenz/Champ-client', 'Default / Faithful', false, 2),
  ('Champ VIP Crystal Pack 64x', 'Exclusive customer pack with custom crystal models, glowing anchors, custom sky, and zero-particle explosions.', 'https://github.com/4ldenz/Champ-client', 'VIP Exclusive', true, 3),
  ('Champ Diamond Prism 128x', 'Premium high-res crystal & mace textures with clean hitboxes and custom sound effects.', 'https://github.com/4ldenz/Champ-client', 'VIP Exclusive', true, 4)
on conflict do nothing;
