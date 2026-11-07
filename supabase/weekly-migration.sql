-- Apply this once in the Supabase SQL Editor for the Champ project.
-- It allows the new weekly plan and refreshes the site announcement.
-- The full schema in schema.sql already contains the same constraint update.

alter table public.pending_payments drop constraint if exists pending_payments_plan_type_check;
alter table public.pending_payments add constraint pending_payments_plan_type_check
  check (plan_type in ('weekly', 'monthly', 'lifetime'));

alter table public.licenses drop constraint if exists licenses_plan_type_check;
alter table public.licenses add constraint licenses_plan_type_check
  check (plan_type in ('weekly', 'monthly', 'lifetime'));

update public.site_settings
set value = '🔥 Champ Client 0.9.9.1 is out for Minecraft 1.21.11 Fabric Loader! Weekly €2.99, Monthly €6.99 or Lifetime €9.99.'
where key = 'announcement_text';
