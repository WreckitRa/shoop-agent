-- Fashion memory: separate path from generic shopping memory.
-- RLS: each table visible/writable only where user_id = auth.uid().

-- ---------------------------------------------------------------------------
-- 1. people
-- ---------------------------------------------------------------------------
create table public.people (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  relation      text not null,
  name          text,
  birthday      date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index people_one_self_per_user
  on public.people (user_id)
  where relation = 'self';

create index people_user_id on public.people (user_id);

-- ---------------------------------------------------------------------------
-- 2. fashion_facts
-- ---------------------------------------------------------------------------
create table public.fashion_facts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  fact_type     text not null,
  garment_type  text,
  value         jsonb not null,
  source_quote  text,
  status        text not null default 'active',
  superseded_by uuid references public.fashion_facts(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index fashion_facts_lookup
  on public.fashion_facts (person_id, fact_type, garment_type)
  where status = 'active';

create index fashion_facts_user_id on public.fashion_facts (user_id);

-- ---------------------------------------------------------------------------
-- 3. style_signals
-- ---------------------------------------------------------------------------
create table public.style_signals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  person_id      uuid not null references public.people(id) on delete cascade,
  context        text not null default 'general',
  signal_type    text not null,
  value          text not null,
  polarity       smallint not null default 1,
  source         text not null,
  confidence     real not null default 0.5,
  evidence_count int not null default 1,
  status         text not null default 'active',
  source_quote   text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create index style_signals_lookup
  on public.style_signals (person_id, context, status);

create unique index style_signals_dedup
  on public.style_signals (person_id, context, signal_type, value, polarity)
  where status in ('active', 'candidate');

create index style_signals_user_id on public.style_signals (user_id);

-- ---------------------------------------------------------------------------
-- 4. request_events
-- ---------------------------------------------------------------------------
create table public.request_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  person_id       uuid not null references public.people(id) on delete cascade,
  conversation_id uuid,
  attributes      jsonb not null,
  created_at      timestamptz not null default now()
);

create index request_events_person
  on public.request_events (person_id, created_at desc);

create index request_events_user_id on public.request_events (user_id);

-- ---------------------------------------------------------------------------
-- 5. extraction_runs
-- ---------------------------------------------------------------------------
create table public.extraction_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  conversation_id  uuid not null,
  last_message_id  uuid not null,
  status           text not null default 'running',
  ops_applied      jsonb,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index extraction_runs_conv
  on public.extraction_runs (conversation_id, created_at desc);

create index extraction_runs_user_id on public.extraction_runs (user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (people, fashion_facts)
-- ---------------------------------------------------------------------------
create or replace function public.fashion_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger people_set_updated_at
  before update on public.people
  for each row execute function public.fashion_set_updated_at();

create trigger fashion_facts_set_updated_at
  before update on public.fashion_facts
  for each row execute function public.fashion_set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create relation='self' row for new auth users
-- ---------------------------------------------------------------------------
create or replace function public.fashion_ensure_self_person_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.people (user_id, relation)
  select p_user_id, 'self'
  where not exists (
    select 1
    from public.people p
    where p.user_id = p_user_id
      and p.relation = 'self'
  );
end;
$$;

create or replace function public.fashion_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fashion_ensure_self_person_for_user(new.id);
  return new;
end;
$$;

drop trigger if exists fashion_on_auth_user_created on auth.users;

create trigger fashion_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fashion_on_auth_user_created();

grant execute on function public.fashion_ensure_self_person_for_user(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.people enable row level security;
alter table public.fashion_facts enable row level security;
alter table public.style_signals enable row level security;
alter table public.request_events enable row level security;
alter table public.extraction_runs enable row level security;

-- people
create policy people_select_own on public.people
  for select using (user_id = auth.uid());
create policy people_insert_own on public.people
  for insert with check (user_id = auth.uid());
create policy people_update_own on public.people
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy people_delete_own on public.people
  for delete using (user_id = auth.uid());

-- fashion_facts
create policy fashion_facts_select_own on public.fashion_facts
  for select using (user_id = auth.uid());
create policy fashion_facts_insert_own on public.fashion_facts
  for insert with check (user_id = auth.uid());
create policy fashion_facts_update_own on public.fashion_facts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy fashion_facts_delete_own on public.fashion_facts
  for delete using (user_id = auth.uid());

-- style_signals
create policy style_signals_select_own on public.style_signals
  for select using (user_id = auth.uid());
create policy style_signals_insert_own on public.style_signals
  for insert with check (user_id = auth.uid());
create policy style_signals_update_own on public.style_signals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy style_signals_delete_own on public.style_signals
  for delete using (user_id = auth.uid());

-- request_events
create policy request_events_select_own on public.request_events
  for select using (user_id = auth.uid());
create policy request_events_insert_own on public.request_events
  for insert with check (user_id = auth.uid());
create policy request_events_update_own on public.request_events
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy request_events_delete_own on public.request_events
  for delete using (user_id = auth.uid());

-- extraction_runs
create policy extraction_runs_select_own on public.extraction_runs
  for select using (user_id = auth.uid());
create policy extraction_runs_insert_own on public.extraction_runs
  for insert with check (user_id = auth.uid());
create policy extraction_runs_update_own on public.extraction_runs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy extraction_runs_delete_own on public.extraction_runs
  for delete using (user_id = auth.uid());
