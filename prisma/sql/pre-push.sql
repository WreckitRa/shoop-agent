-- Combined pre-push SQL for db:deploy (idempotent).

-- >>> prisma/sql/drop-fashion-auth-fkeys.sql
-- Drop cross-schema FKs to auth.users so Prisma can manage public tables
-- without declaring the auth schema (which would make db push try to drop
-- Supabase Auth tables). user_id columns + RLS remain the access guard.

alter table public.people
  drop constraint if exists people_user_id_fkey;

alter table public.fashion_facts
  drop constraint if exists fashion_facts_user_id_fkey;

alter table public.style_signals
  drop constraint if exists style_signals_user_id_fkey;

alter table public.request_events
  drop constraint if exists request_events_user_id_fkey;


-- >>> prisma/sql/search-pools.sql
-- Pool persistence + interaction signal dedup (also in supabase/migrations/20260713120000_search_pools.sql).
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

create table if not exists public.interaction_signal_dedup (
  search_id    text not null,
  interaction  text not null,
  ref          text not null,
  created_at   timestamptz not null default now(),
  primary key (search_id, interaction, ref)
);

create index if not exists interaction_signal_dedup_search
  on public.interaction_signal_dedup (search_id);


-- >>> prisma/sql/tryon.sql
-- Try-on tables (also in supabase/migrations/20260713140000_tryon.sql)

ALTER TABLE public."UserProfile"
  ADD COLUMN IF NOT EXISTS tryon_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tryon_outfits_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tryon_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  provider text NOT NULL,
  input_refs jsonb NOT NULL DEFAULT '{}',
  output_url text,
  output_path text,
  ms int,
  cost_estimate real,
  status text NOT NULL DEFAULT 'pending',
  error text,
  search_id text,
  product_ref text,
  avatar_version text,
  look_id text,
  step_index int,
  parent_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tryon_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, user_id)
);

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS avatar jsonb,
  ADD COLUMN IF NOT EXISTS avatar_source_photo_path text;


-- >>> prisma/sql/migrate-unisex-person-department.sql
-- Migrate legacy person-side gender_presentation "unisex" → "mixed".
-- Person departments never include unisex (shop both = mixed).
-- Product/filter Unisex is unchanged.

UPDATE fashion_facts
SET value = jsonb_set(value, '{presentation}', '"mixed"', true),
    updated_at = NOW()
WHERE fact_type = 'gender_presentation'
  AND status IN ('active', 'candidate')
  AND value->>'presentation' = 'unisex';


-- >>> prisma/sql/drop-avatar-drafts.sql
-- Avatar drafts were removed from the Prisma schema (avatar rework) but may still
-- exist on live DBs with rows. `prisma db push` refuses to auto-drop non-empty
-- tables, so drop explicitly before push. Recreated after push in avatar-drafts.sql
-- for the Supabase-client draft store (not managed by Prisma).

DROP TABLE IF EXISTS public.avatar_drafts;


-- >>> prisma/sql/purge-legacy-prompt-kinds.sql
-- Remove PromptRun rows whose kinds are being dropped from PromptRunKind
-- (fashion-only chat no longer records these). Prisma cannot alter the enum
-- while any row still uses a dropped variant.

DELETE FROM public."PromptRun"
WHERE kind::text IN (
  'topic_guard',
  'intent_shift',
  'search_query_planner',
  'search_pipeline'
);


