-- Persistent slot pools for fashion search interactions (14-day working lifecycle).
create table if not exists public.search_pools (
  search_id   text not null,
  slot_id     text not null,
  user_id     text not null,
  state       jsonb not null,
  version     int not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (search_id, slot_id)
);

create index if not exists search_pools_user_updated
  on public.search_pools (user_id, updated_at desc);

-- Idempotent interaction → signal writes (one row per interaction+ref).
create table if not exists public.interaction_signal_dedup (
  search_id    text not null,
  interaction  text not null,
  ref          text not null,
  created_at   timestamptz not null default now(),
  primary key (search_id, interaction, ref)
);

create index if not exists interaction_signal_dedup_search
  on public.interaction_signal_dedup (search_id);
