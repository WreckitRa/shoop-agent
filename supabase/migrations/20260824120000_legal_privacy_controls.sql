-- Legal / privacy product fields (age, consent, share expiry, biometric log).

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
