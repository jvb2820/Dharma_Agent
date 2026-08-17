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

update public.respond_processed_messages
set expires_at = coalesce(completed_at, updated_at, created_at) + interval '24 hours'
where status = 'completed';

delete from public.respond_processed_messages where expires_at <= now();
