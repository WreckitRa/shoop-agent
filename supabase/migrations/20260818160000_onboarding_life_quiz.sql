-- Onboarding life-context quiz: week, relationship, kids.
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "weekIs" TEXT,
  ADD COLUMN IF NOT EXISTS "dressingFor" TEXT,
  ADD COLUMN IF NOT EXISTS "kids" TEXT;
