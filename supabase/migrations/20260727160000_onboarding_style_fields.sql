-- Onboarding wireframe: style era, honesty dial, compliments, style mix card.
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "styleEra" TEXT,
  ADD COLUMN IF NOT EXISTS "honestyPreference" TEXT,
  ADD COLUMN IF NOT EXISTS "complimentPreferences" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "styleMix" JSONB;
