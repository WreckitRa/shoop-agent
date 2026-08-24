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
-- Isolated LLM style-photo analysis. Display only — never consumed by search.
CREATE TABLE IF NOT EXISTS "PhotoAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "gate" JSONB,
  "result" JSONB,
  "userReview" JSONB,
  "verdict" JSONB,
  "verdictStatus" TEXT NOT NULL DEFAULT 'idle',
  "verdictError" TEXT,
  "verdictMs" INTEGER,
  "verdictModel" TEXT,
  "error" TEXT,
  "ms" INTEGER,
  "model" TEXT,
  "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PhotoAnalysis_userId_photoHash_key"
  ON "PhotoAnalysis" ("userId", "photoHash");

CREATE INDEX IF NOT EXISTS "PhotoAnalysis_userId_createdAt_idx"
  ON "PhotoAnalysis" ("userId", "createdAt" DESC);

-- Columns added after the first PhotoAnalysis table (CREATE IF NOT EXISTS
-- does not upgrade an older shape).
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "gate" JSONB;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "userReview" JSONB;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdict" JSONB;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictError" TEXT;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictMs" INTEGER;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictModel" TEXT;


-- >>> supabase/migrations/20260824120000_legal_privacy_controls.sql
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "termsVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "shareLikenessConsentAt" TIMESTAMP(3);

ALTER TABLE "look_ask_shares"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokeReason" TEXT;

UPDATE "look_ask_shares"
SET "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "expiresAt" IS NULL;

CREATE INDEX IF NOT EXISTS "look_ask_shares_expiresAt_idx"
  ON "look_ask_shares" ("expiresAt");

CREATE TABLE IF NOT EXISTS "biometric_consents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "documentVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "biometric_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "biometric_consents_userId_createdAt_idx"
  ON "biometric_consents" ("userId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "privacy_deletion_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fashnNote" TEXT NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "privacy_deletion_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "privacy_deletion_events_userId_completedAt_idx"
  ON "privacy_deletion_events" ("userId", "completedAt" DESC);

CREATE INDEX IF NOT EXISTS "privacy_deletion_events_kind_completedAt_idx"
  ON "privacy_deletion_events" ("kind", "completedAt");

