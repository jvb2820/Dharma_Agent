create table if not exists public.respond_conversation_sessions (
  contact_id text primary key,
  session_data jsonb not null default '{}'::jsonb,
  last_interaction_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists respond_conversation_sessions_expires_at_idx
  on public.respond_conversation_sessions (expires_at);

alter table public.respond_conversation_sessions enable row level security;

