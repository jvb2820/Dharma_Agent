create table if not exists public.respond_slot_claims (
  slot_key text primary key,
  contact_id text not null,
  seller_slug text not null,
  start_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists respond_slot_claims_expires_at_idx
  on public.respond_slot_claims (expires_at);

alter table public.respond_slot_claims enable row level security;

create or replace function public.acquire_respond_slot_claim(
  claim_slot_key text,
  claim_contact_id text,
  claim_seller_slug text,
  claim_start_at timestamptz,
  claim_ttl_seconds integer default 180
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.respond_slot_claims where expires_at <= now();

  insert into public.respond_slot_claims (
    slot_key, contact_id, seller_slug, start_at, expires_at, updated_at
  ) values (
    claim_slot_key,
    claim_contact_id,
    claim_seller_slug,
    claim_start_at,
    now() + make_interval(secs => greatest(claim_ttl_seconds, 30)),
    now()
  )
  on conflict (slot_key) do update
    set expires_at = excluded.expires_at, updated_at = now()
    where respond_slot_claims.contact_id = excluded.contact_id;

  return exists (
    select 1 from public.respond_slot_claims
    where slot_key = claim_slot_key and contact_id = claim_contact_id and expires_at > now()
  );
end;
$$;
