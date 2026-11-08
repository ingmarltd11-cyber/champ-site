-- Apply this once in the Supabase SQL Editor for the Champ project.
-- It enables the free 24-hour trial and the two limits: one per network, one per PC.
-- Safe to run more than once.

alter table public.licenses drop constraint if exists licenses_plan_type_check;
alter table public.licenses add constraint licenses_plan_type_check
  check (plan_type in ('trial', 'weekly', 'monthly', 'lifetime'));

-- The network that claimed the trial. Separate from bound_ip, which the injector fills on
-- first launch: the claim IP is what the "one trial per network" rule is checked against.
alter table public.licenses add column if not exists trial_ip text not null default '';

-- Partial unique indexes: only trial rows count, and only once they have a value. These make
-- the limits hold even when two requests race, and are what the API reports as a 409.
create unique index if not exists licenses_trial_ip_uniq on public.licenses (trial_ip)
  where plan_type = 'trial' and trial_ip <> '';
create unique index if not exists licenses_trial_hwid_uniq on public.licenses (hwid)
  where plan_type = 'trial' and hwid <> '';
