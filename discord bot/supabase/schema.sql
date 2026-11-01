-- Ticket rows used by the Discord bot when SUPABASE_URL + SUPABASE_SERVICE_KEY are set.
-- Without Supabase the bot keeps the same records in data/tickets.json.
create table if not exists public.tickets (
  channel_id text primary key,
  guild_id text not null,
  user_id text not null,
  type_id text not null,
  status text not null default 'open',
  claimed_by text,
  answers jsonb not null default '{}'::jsonb,
  rating integer,
  rating_comment text,
  transcript text,
  warned boolean not null default false,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists tickets_status_idx on public.tickets (status);
create index if not exists tickets_user_idx on public.tickets (user_id);
create index if not exists tickets_activity_idx on public.tickets (last_activity_at);

-- The bot authenticates with the service key, which bypasses RLS. No public policies are
-- created on purpose: ticket transcripts may contain order ids and private messages.
alter table public.tickets enable row level security;
