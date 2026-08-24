-- Timestamped privacy deletion evidence. Not deleted with the user account.

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
