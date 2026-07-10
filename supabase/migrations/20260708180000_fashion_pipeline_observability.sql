-- Fashion pipeline observability: traces, LLM audit, stage events, prompt dedup.

create table public.traces (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  conversation_id text not null,
  kind            text not null default 'search_turn',
  status          text not null default 'open',
  summary         jsonb,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index traces_conversation on public.traces (conversation_id, created_at desc);
create index traces_user on public.traces (user_id, created_at desc);

create table public.prompt_versions (
  hash        text primary key,
  stage       text not null,
  content     text not null,
  first_seen  timestamptz not null default now()
);

create table public.llm_calls (
  id                 uuid primary key default gen_random_uuid(),
  trace_id           uuid not null references public.traces(id) on delete cascade,
  stage              text not null,
  model              text not null,
  system_prompt_hash text references public.prompt_versions(hash),
  input_messages     jsonb not null,
  tool_choice        jsonb,
  raw_output         jsonb not null,
  latency_ms         int,
  input_tokens       int,
  output_tokens      int,
  error              text,
  created_at         timestamptz not null default now()
);

create index llm_calls_trace on public.llm_calls (trace_id, created_at);

create table public.pipeline_events (
  id         uuid primary key default gen_random_uuid(),
  trace_id   uuid not null references public.traces(id) on delete cascade,
  stage      text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index pipeline_events_trace on public.pipeline_events (trace_id, created_at);

-- Traces with invariant tripwires for daily review.
create or replace view public.flagged_traces as
select distinct t.*
from public.traces t
join public.pipeline_events e on e.trace_id = t.id
where e.stage = 'invariant_warning';

-- RLS: service role only (admin client bypasses RLS).
alter table public.traces enable row level security;
alter table public.llm_calls enable row level security;
alter table public.pipeline_events enable row level security;
alter table public.prompt_versions enable row level security;
