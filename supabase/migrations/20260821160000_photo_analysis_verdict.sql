-- User review of photo analysis + stored stylist verdict.
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "userReview" JSONB;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdict" JSONB;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictError" TEXT;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictMs" INTEGER;
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "verdictModel" TEXT;
