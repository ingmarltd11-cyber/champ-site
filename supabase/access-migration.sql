-- Run once in Supabase SQL Editor after deploying the admin/trial changes.
-- Safe to run more than once.

-- Per-network signup cap. Existing accounts keep an empty value and are not counted.
alter table public.users add column if not exists signup_ip text not null default '';
create index if not exists users_signup_ip_idx on public.users (signup_ip, created_at desc);

-- Storefront switches. The trial is off by default; the admin can re-enable it.
insert into public.site_settings (key, value)
values
  ('trial_enabled', 'false'),
  ('trial_hours', '24'),
  ('signup_enabled', 'true'),
  ('signup_max_per_ip', '3'),
  ('payment_donut_mode', 'manual')
on conflict (key) do nothing;

-- Remove the old trial sentence when the pricing subtitle still has the old default.
update public.site_settings
set value = 'Weekly, monthly or lifetime. Pay with crypto, DonutSMP money or a gift card; the license lands in your dashboard as soon as the payment clears.'
where key = 'pricing_sub'
  and value like 'Start with a free 24-hour trial%';