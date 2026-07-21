create table if not exists public.respond_post_booking_locks (
  contact_id text primary key,
  booking_id text,
  assignee text not null,
  meeting_start_at timestamptz not null,
  meeting_end_at timestamptz not null,
  locked_until timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expired_at timestamptz
);

create index if not exists respond_post_booking_locks_active_until_idx
  on public.respond_post_booking_locks (status, locked_until);

alter table public.respond_post_booking_locks enable row level security;
