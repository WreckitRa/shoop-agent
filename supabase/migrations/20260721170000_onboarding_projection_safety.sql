-- Keep one active fact per person/fact/garment slot. Normalize NULL garment
-- types so identity facts are protected by the same uniqueness rule.
with ranked as (
  select
    id,
    row_number() over (
      partition by person_id, fact_type, coalesce(garment_type, '')
      order by updated_at desc, created_at desc, id desc
    ) as position
  from public.fashion_facts
  where status = 'active'
)
update public.fashion_facts facts
set status = 'superseded'
from ranked
where facts.id = ranked.id
  and ranked.position > 1;

create unique index if not exists fashion_facts_one_active_slot
  on public.fashion_facts (
    person_id,
    fact_type,
    coalesce(garment_type, '')
  )
  where status = 'active';
