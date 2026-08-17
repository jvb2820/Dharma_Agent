create table if not exists public.respond_contact_locks (
  contact_id text primary key,
  owner_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.respond_processed_messages (
  contact_id text not null,
  message_id text not null,
  owner_id text not null,
  status text not null default 'processing' check (status in ('processing', 'completed')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contact_id, message_id)
);

create index if not exists respond_contact_locks_expires_at_idx on public.respond_contact_locks (expires_at);
create index if not exists respond_processed_messages_expires_at_idx on public.respond_processed_messages (expires_at);
alter table public.respond_contact_locks enable row level security;
alter table public.respond_processed_messages enable row level security;

create or replace function public.acquire_respond_contact_lock(
  lock_contact_id text,
  lock_owner_id text,
  lock_ttl_seconds integer default 300
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.respond_contact_locks (contact_id, owner_id, expires_at)
  values (lock_contact_id, lock_owner_id, now() + make_interval(secs => greatest(lock_ttl_seconds, 30)))
  on conflict (contact_id) do update set
    owner_id = excluded.owner_id,
    expires_at = excluded.expires_at,
    updated_at = now()
  where respond_contact_locks.expires_at <= now() or respond_contact_locks.owner_id = excluded.owner_id;

  return exists (
    select 1 from public.respond_contact_locks
    where contact_id = lock_contact_id and owner_id = lock_owner_id and expires_at > now()
  );
end;
$$;

create or replace function public.claim_respond_webhook_message(
  claim_contact_id text,
  claim_message_id text,
  claim_owner_id text,
  claim_ttl_seconds integer default 300
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.respond_processed_messages where expires_at <= now();

  insert into public.respond_processed_messages (
    contact_id, message_id, owner_id, status, expires_at
  ) values (
    claim_contact_id, claim_message_id, claim_owner_id, 'processing',
    now() + make_interval(secs => greatest(claim_ttl_seconds, 30))
  ) on conflict (contact_id, message_id) do nothing;

  return exists (
    select 1 from public.respond_processed_messages
    where contact_id = claim_contact_id and message_id = claim_message_id and owner_id = claim_owner_id
  );
end;
$$;
