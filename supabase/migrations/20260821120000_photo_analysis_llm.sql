-- Isolated LLM style-photo analysis. Display only — never consumed by search.
-- Replaces the spec/GPT bakeoff columns. No one used the previous table.

DROP TABLE IF EXISTS "PhotoAnalysis";

CREATE TABLE "PhotoAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "result" JSONB,
  "error" TEXT,
  "ms" INTEGER,
  "model" TEXT,
  "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoAnalysis_userId_photoHash_key"
  ON "PhotoAnalysis" ("userId", "photoHash");

CREATE INDEX "PhotoAnalysis_userId_createdAt_idx"
  ON "PhotoAnalysis" ("userId", "createdAt" DESC);
