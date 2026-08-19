-- Combined post-push SQL for db:deploy (idempotent).

-- >>> prisma/sql/avatar-drafts.sql
-- Avatar draft progress store (Supabase client, not a Prisma model).
-- Applied after `prisma db push` so Prisma does not try to drop it as an orphan.

CREATE TABLE IF NOT EXISTS public.avatar_drafts (
  person_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  step text NOT NULL DEFAULT 'upload',
  photo_path text,
  attributes jsonb,
  preview_url text,
  preview_path text,
  preview_variants jsonb,
  selected_provider_key text,
  regen_count int NOT NULL DEFAULT 0,
  minor_refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_drafts_user_id ON public.avatar_drafts(user_id);


-- >>> supabase/migrations/20260721170000_onboarding_projection_safety.sql
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


-- >>> supabase/migrations/20260727160000_onboarding_style_fields.sql
-- Onboarding wireframe: style era, honesty dial, compliments, style mix card.
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "styleEra" TEXT,
  ADD COLUMN IF NOT EXISTS "honestyPreference" TEXT,
  ADD COLUMN IF NOT EXISTS "complimentPreferences" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "styleMix" JSONB;


-- >>> supabase/migrations/20260818160000_onboarding_life_quiz.sql
-- Onboarding life-context quiz: week, relationship, kids.
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "weekIs" TEXT,
  ADD COLUMN IF NOT EXISTS "dressingFor" TEXT,
  ADD COLUMN IF NOT EXISTS "kids" TEXT;


-- >>> supabase/migrations/20260818180000_photo_analysis.sql
-- Isolated photo bakeoff (spec vs GPT). Display only — never consumed by search.
CREATE TABLE IF NOT EXISTS "PhotoAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "specStatus" TEXT NOT NULL DEFAULT 'pending',
  "gptStatus" TEXT NOT NULL DEFAULT 'pending',
  "specResult" JSONB,
  "gptResult" JSONB,
  "specError" TEXT,
  "gptError" TEXT,
  "specMs" INTEGER,
  "gptMs" INTEGER,
  "gptModel" TEXT,
  "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PhotoAnalysis_userId_photoHash_key"
  ON "PhotoAnalysis" ("userId", "photoHash");

CREATE INDEX IF NOT EXISTS "PhotoAnalysis_userId_createdAt_idx"
  ON "PhotoAnalysis" ("userId", "createdAt" DESC);


