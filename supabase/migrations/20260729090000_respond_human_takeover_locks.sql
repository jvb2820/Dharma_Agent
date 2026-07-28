create table if not exists public.respond_human_takeover_locks (
  contact_id text primary key,
  assignee text not null,
  phase text not null default 'assigned' check (phase in ('assigned', 'cooldown')),
  assigned_at timestamptz not null default now(),
  closed_at timestamptz,
  locked_until timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expired_at timestamptz
);

create index if not exists respond_human_takeover_locks_active_until_idx
  on public.respond_human_takeover_locks (status, phase, locked_until);

alter table public.respond_human_takeover_locks enable row level security;
