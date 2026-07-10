-- Prisma conversation ids are cuid strings, not Postgres uuids.
drop view if exists public.flagged_traces;

alter table public.traces
  alter column conversation_id type text using conversation_id::text;

create or replace view public.flagged_traces as
select distinct t.*
from public.traces t
join public.pipeline_events e on e.trace_id = t.id
where e.stage = 'invariant_warning';
