-- Apply this once in the Supabase SQL Editor for the Champ project.
-- One row per launch that actually injected (account session or licence key).
--
-- The launcher's session cookie is a full thirty-day login, so the raw token is never stored:
-- `session_ref` is a keyed, one-way reference. The same session can be recognised across
-- launches, but a database read cannot be turned back into a working credential.
-- Safe to run more than once.

create table if not exists public.inject_events (
  id            bigint generated always as identity primary key,
  license_id    bigint,
  email         text not null default '',
  plan_type     text not null default '',
  session_kind  text not null default 'account' check (session_kind in ('account', 'key')),
  session_ref   text not null default '',
  ip            text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists inject_events_license_idx
  on public.inject_events (license_id, created_at desc);
create index if not exists inject_events_ref_idx
  on public.inject_events (session_ref) where session_ref <> '';

alter table public.inject_events enable row level security;
