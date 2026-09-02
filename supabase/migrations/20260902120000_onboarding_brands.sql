-- Shared catalog of shopper-typed brand names (seed tiles stay in code).
CREATE TABLE IF NOT EXISTS "OnboardingBrand" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingBrand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingBrand_slug_key" ON "OnboardingBrand"("slug");
CREATE INDEX IF NOT EXISTS "OnboardingBrand_name_idx" ON "OnboardingBrand"("name");
