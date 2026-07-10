create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null default 'sales',
  category text not null check (
    category in ('privacy', 'compliance', 'sales_workflow', 'tone', 'product', 'booking')
  ),
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'manual',
  embedding vector(1536) not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_suggestions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null default 'sales',
  category text not null check (
    category in ('privacy', 'compliance', 'sales_workflow', 'tone', 'product', 'booking')
  ),
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'auto_suggest',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists agent_memories_embedding_hnsw_idx
on public.agent_memories
using hnsw (embedding vector_cosine_ops);

create index if not exists agent_memories_agent_status_idx
on public.agent_memories (agent_id, status, category);

create index if not exists memory_suggestions_status_idx
on public.memory_suggestions (status, created_at desc);

drop trigger if exists set_agent_memories_updated_at on public.agent_memories;

create trigger set_agent_memories_updated_at
before update on public.agent_memories
for each row
execute function public.set_updated_at();

create or replace function public.match_approved_agent_memories(
  query_embedding vector(1536),
  match_agent_id text default 'sales',
  match_count int default 5
)
returns table (
  memory_id uuid,
  agent_id text,
  category text,
  content text,
  source text,
  similarity float
)
language sql
stable
as $$
  select
    am.id as memory_id,
    am.agent_id,
    am.category,
    am.content,
    am.source,
    1 - (am.embedding <=> query_embedding) as similarity
  from public.agent_memories am
  where am.agent_id = match_agent_id
    and am.status = 'approved'
  order by am.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.agent_memories enable row level security;
alter table public.memory_suggestions enable row level security;

drop policy if exists "Allow public read of approved agent memories" on public.agent_memories;
create policy "Allow public read of approved agent memories"
on public.agent_memories
for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "Allow public read of pending memory suggestions" on public.memory_suggestions;
create policy "Allow public read of pending memory suggestions"
on public.memory_suggestions
for select
to anon, authenticated
using (status = 'pending');
