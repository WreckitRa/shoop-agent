-- Isolated photo bakeoff (spec vs GPT). Display only — never consumed by search.
-- Replaced by 20260821120000_photo_analysis_llm.sql.
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
