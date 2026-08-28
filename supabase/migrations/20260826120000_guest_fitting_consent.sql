-- Guest fitting consent flags on the BIPA release log.

ALTER TABLE "biometric_consents"
  ADD COLUMN IF NOT EXISTS "ageAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ownPhotoAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "abandonDeleteAck" BOOLEAN NOT NULL DEFAULT false;
