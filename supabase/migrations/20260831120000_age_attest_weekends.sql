-- Signup age attestation (no DOB) + weekend life chips.
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "ageAttestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "weekendsAre" TEXT;
