create extension if not exists vector;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null default 'sales',
  title text not null,
  bucket text not null,
  storage_path text not null,
  source_type text not null check (
    source_type in ('company_info', 'raw_conversation', 'approved_example', 'sales_script', 'product_info', 'compliance')
  ),
  mime_type text,
  status text not null default 'pending' check (status in ('pending', 'indexed', 'failed')),
  error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  agent_id text not null default 'sales',
  source_type text not null,
  chunk_index int not null,
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_embedding_hnsw_idx
on public.document_chunks
using hnsw (embedding vector_cosine_ops);

create index if not exists document_chunks_agent_source_idx
on public.document_chunks (agent_id, source_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_documents_updated_at on public.documents;

create trigger set_documents_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

create or replace function public.match_agent_knowledge(
  query_embedding vector(1536),
  match_agent_id text default 'sales',
  match_source_types text[] default array['company_info', 'approved_example', 'sales_script', 'product_info', 'compliance'],
  match_count int default 6
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  source_type text,
  storage_path text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    dc.id as chunk_id,
    d.id as document_id,
    d.title,
    dc.source_type,
    d.storage_path,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.agent_id = match_agent_id
    and dc.source_type = any(match_source_types)
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

drop policy if exists "Allow public read of indexed documents" on public.documents;
create policy "Allow public read of indexed documents"
on public.documents
for select
to anon, authenticated
using (status = 'indexed');

drop policy if exists "Allow public read of document chunks" on public.document_chunks;
create policy "Allow public read of document chunks"
on public.document_chunks
for select
to anon, authenticated
using (true);
