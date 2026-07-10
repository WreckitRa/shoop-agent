-- Admin dashboard read-only views (shoop-admin-v2).
-- Safe to re-run: CREATE OR REPLACE VIEW + IF NOT EXISTS indexes.

-- ---------------------------------------------------------------------------
-- Indexes backing admin access paths
-- ---------------------------------------------------------------------------
create index if not exists pipeline_events_stage_created
  on public.pipeline_events (stage, created_at desc);

create index if not exists llm_calls_stage_created
  on public.llm_calls (stage, created_at desc);

create index if not exists style_signals_source_seen
  on public.style_signals (source, last_seen_at desc);

create index if not exists request_events_conversation
  on public.request_events (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- v_search_traces — one row per fashion search trace
-- ---------------------------------------------------------------------------
create or replace view public.v_search_traces as
select
  t.id as trace_id,
  t.created_at,
  t.closed_at,
  t.user_id,
  t.conversation_id,
  t.kind,
  t.status,
  t.summary,
  coalesce(t.summary->>'route', '') as route,
  coalesce(t.summary->>'mode', '') as mode,
  coalesce((t.summary->>'slots')::int, 0) as slot_count,
  coalesce((t.summary->>'total_hits')::int, 0) as total_hits,
  coalesce((t.summary->>'total_ms')::int, 0) as total_ms,
  exists (
    select 1 from public.pipeline_events e
    where e.trace_id = t.id and e.stage = 'invariant_warning'
  ) as has_invariant_warnings,
  exists (
    select 1 from public.pipeline_events e
    where e.trace_id = t.id
      and e.stage = 'hydration'
      and coalesce((e.payload->>'thin')::boolean, false)
  ) as has_thin_slot,
  (
    select e.payload->>'recipient_person_id'
    from public.pipeline_events e
    where e.trace_id = t.id and e.stage = 'brief_persisted'
    order by e.created_at desc
    limit 1
  ) as recipient_person_id
from public.traces t
where t.kind = 'search_turn';

-- ---------------------------------------------------------------------------
-- v_trace_events — pipeline events ordered per trace
-- ---------------------------------------------------------------------------
create or replace view public.v_trace_events as
select
  e.id as event_id,
  e.trace_id,
  e.stage,
  e.payload,
  e.created_at
from public.pipeline_events e;

-- ---------------------------------------------------------------------------
-- v_trace_llm_calls — llm_calls joined to prompt_versions
-- ---------------------------------------------------------------------------
create or replace view public.v_trace_llm_calls as
select
  c.id as call_id,
  c.trace_id,
  c.stage,
  c.model,
  c.system_prompt_hash,
  c.input_messages,
  c.tool_choice,
  c.raw_output,
  c.latency_ms,
  c.input_tokens,
  c.output_tokens,
  c.error,
  c.created_at,
  p.stage as prompt_stage,
  p.content as prompt_content,
  p.first_seen as prompt_first_seen
from public.llm_calls c
left join public.prompt_versions p on p.hash = c.system_prompt_hash;

-- ---------------------------------------------------------------------------
-- v_funnel_counts — per trace + slot funnel reconstruction from stage events
-- ---------------------------------------------------------------------------
create or replace view public.v_funnel_counts as
with slots as (
  select distinct
    e.trace_id,
    coalesce(e.payload->>'slot_id', '') as slot_id
  from public.pipeline_events e
  where e.stage in ('ucp_coverage', 'hard_drops', 'scoring', 'hydration')
    and e.payload->>'slot_id' is not null
),
coverage as (
  select
    e.trace_id,
    e.payload->>'slot_id' as slot_id,
    coalesce((e.payload->>'products')::int, 0) as retrieved
  from public.pipeline_events e
  where e.stage = 'ucp_coverage'
),
drops as (
  select
    e.trace_id,
    e.payload->>'slot_id' as slot_id,
    coalesce((e.payload->>'in')::int, 0) as deduped_in,
    coalesce((e.payload->>'out')::int, 0) as after_drops,
    e.payload->'drops_by_rule' as dropped_by_rule
  from public.pipeline_events e
  where e.stage = 'hard_drops'
),
scoring as (
  select
    e.trace_id,
    e.payload->>'slot_id' as slot_id,
    coalesce((e.payload->>'products')::int, 0) as survivors
  from public.pipeline_events e
  where e.stage = 'scoring'
),
hydration as (
  select
    e.trace_id,
    e.payload->>'slot_id' as slot_id,
    coalesce((e.payload->>'verified_final')::int, 0) as verified_final,
    coalesce((e.payload->>'overflow_count')::int, 0) as overflow_count,
    coalesce((e.payload->>'thin')::boolean, false) as thin,
    e.payload->'killed' as killed_by_cause
  from public.pipeline_events e
  where e.stage = 'hydration'
)
select
  s.trace_id,
  s.slot_id,
  coalesce(c.retrieved, 0) as retrieved,
  coalesce(d.deduped_in, 0) as deduped,
  coalesce(d.after_drops, 0) as after_drops,
  d.dropped_by_rule,
  coalesce(sc.survivors, 0) as survivors,
  coalesce(h.verified_final, 0) as verified_final,
  coalesce(h.verified_final, 0) as shown,
  coalesce(h.overflow_count, 0) as overflow_count,
  coalesce(h.thin, false) as thin,
  h.killed_by_cause
from slots s
left join coverage c on c.trace_id = s.trace_id and c.slot_id = s.slot_id
left join drops d on d.trace_id = s.trace_id and d.slot_id = s.slot_id
left join scoring sc on sc.trace_id = s.trace_id and sc.slot_id = s.slot_id
left join hydration h on h.trace_id = s.trace_id and h.slot_id = s.slot_id;

-- ---------------------------------------------------------------------------
-- v_daily_health — daily aggregates for /health charts
-- ---------------------------------------------------------------------------
create or replace view public.v_daily_health as
with days as (
  select distinct date_trunc('day', t.created_at)::date as day
  from public.traces t
  where t.kind = 'search_turn'
),
search_counts as (
  select
    date_trunc('day', t.created_at)::date as day,
    count(*) as searches,
    count(*) filter (where coalesce(t.summary->>'mode', '') = 'single_item') as searches_single,
    count(*) filter (where coalesce(t.summary->>'mode', '') = 'outfit') as searches_outfit
  from public.traces t
  where t.kind = 'search_turn'
  group by 1
),
normalize_stats as (
  select
    date_trunc('day', e.created_at)::date as day,
    count(*) as normalize_events,
    sum(coalesce((e.payload->>'cache_hits')::int, 0)) as cache_hits,
    sum(coalesce((e.payload->>'labels_total')::int, 0)) as labels_total
  from public.pipeline_events e
  where e.stage = 'normalize'
  group by 1
),
drop_stats as (
  select
    date_trunc('day', e.created_at)::date as day,
    sum(coalesce((e.payload->>'in')::int, 0)) as drop_in,
    sum(coalesce((e.payload->>'in')::int, 0) - coalesce((e.payload->>'out')::int, 0)) as drop_count
  from public.pipeline_events e
  where e.stage = 'hard_drops'
  group by 1
),
hydration_stats as (
  select
    date_trunc('day', e.created_at)::date as day,
    sum(coalesce((e.payload->>'shortlisted')::int, 0)) as hydration_shortlisted,
    sum(coalesce((e.payload->'killed')::text::int, 0)) filter (where false) as hydration_killed_placeholder,
    count(*) filter (where coalesce((e.payload->>'thin')::boolean, false)) as thin_slot_count,
    count(*) as hydration_events
  from public.pipeline_events e
  where e.stage = 'hydration'
  group by 1
),
hydration_kills as (
  select
    date_trunc('day', e.created_at)::date as day,
    sum(
      coalesce((e.payload->'killed'->>'size_out_of_stock')::int, 0) +
      coalesce((e.payload->'killed'->>'size_not_offered')::int, 0) +
      coalesce((e.payload->'killed'->>'gone')::int, 0) +
      coalesce((e.payload->'killed'->>'department_mismatch')::int, 0)
    ) as hydration_killed
  from public.pipeline_events e
  where e.stage = 'hydration'
  group by 1
),
warning_counts as (
  select
    date_trunc('day', e.created_at)::date as day,
    count(*) as invariant_warnings,
    count(*) filter (
      where coalesce(e.payload->>'kind', e.payload->>'code', '') ilike '%department%'
    ) as department_mismatch_warnings
  from public.pipeline_events e
  where e.stage = 'invariant_warning'
  group by 1
),
llm_latency as (
  select
    date_trunc('day', c.created_at)::date as day,
    c.stage,
    percentile_cont(0.5) within group (order by c.latency_ms) as latency_p50,
    percentile_cont(0.95) within group (order by c.latency_ms) as latency_p95,
    sum(coalesce(c.input_tokens, 0)) as input_tokens,
    sum(coalesce(c.output_tokens, 0)) as output_tokens
  from public.llm_calls c
  group by 1, 2
),
llm_latency_agg as (
  select
    day,
    jsonb_object_agg(
      stage,
      jsonb_build_object('p50', latency_p50, 'p95', latency_p95)
    ) as stage_latency,
    sum(input_tokens) as input_tokens,
    sum(output_tokens) as output_tokens
  from llm_latency
  group by day
)
select
  d.day,
  coalesce(sc.searches, 0) as searches,
  coalesce(sc.searches_single, 0) as searches_single,
  coalesce(sc.searches_outfit, 0) as searches_outfit,
  case
    when coalesce(ns.labels_total, 0) > 0
    then ns.cache_hits::float / ns.labels_total
    else null
  end as normalize_cache_hit_rate,
  case
    when coalesce(ds.drop_in, 0) > 0
    then ds.drop_count::float / ds.drop_in
    else null
  end as drop_rate,
  case
    when coalesce(hs.hydration_shortlisted, 0) > 0
    then coalesce(hk.hydration_killed, 0)::float / hs.hydration_shortlisted
    else null
  end as hydration_kill_rate,
  case
    when coalesce(hs.hydration_events, 0) > 0
    then hs.thin_slot_count::float / hs.hydration_events
    else null
  end as thin_slot_rate,
  coalesce(wc.invariant_warnings, 0) as invariant_warnings,
  coalesce(wc.department_mismatch_warnings, 0) as department_mismatch_warnings,
  la.stage_latency,
  coalesce(la.input_tokens, 0) as input_tokens,
  coalesce(la.output_tokens, 0) as output_tokens
from days d
left join search_counts sc on sc.day = d.day
left join normalize_stats ns on ns.day = d.day
left join drop_stats ds on ds.day = d.day
left join hydration_stats hs on hs.day = d.day
left join hydration_kills hk on hk.day = d.day
left join warning_counts wc on wc.day = d.day
left join llm_latency_agg la on la.day = d.day
order by d.day desc;

-- ---------------------------------------------------------------------------
-- v_user_reactions — style signals + request events (ground-truth outcomes)
-- ---------------------------------------------------------------------------
create or replace view public.v_user_reactions as
select
  s.id as reaction_id,
  'style_signal' as reaction_kind,
  s.user_id,
  s.person_id,
  null::text as conversation_id,
  null::uuid as trace_id,
  s.signal_type,
  s.value,
  s.polarity,
  s.source,
  s.confidence,
  s.last_seen_at as created_at
from public.style_signals s
where s.status = 'active'
  and s.source in ('inferred', 'rejection')
union all
select
  r.id as reaction_id,
  'request_event' as reaction_kind,
  r.user_id,
  r.person_id,
  r.conversation_id,
  null::uuid as trace_id,
  coalesce(r.attributes->>'request_type', 'request') as signal_type,
  coalesce(r.attributes->>'garment', r.attributes->>'occasion', '') as value,
  1 as polarity,
  'request_event' as source,
  1.0 as confidence,
  r.created_at
from public.request_events r;
