-- Luna preflight gate stored alongside the Terra analysis result.
ALTER TABLE "PhotoAnalysis" ADD COLUMN IF NOT EXISTS "gate" JSONB;
