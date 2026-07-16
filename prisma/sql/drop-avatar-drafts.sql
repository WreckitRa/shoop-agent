-- Remove the legacy avatar_drafts table superseded by the new avatar schema
-- introduced in the "added avatar" change. Non-empty (1 row) in production,
-- so prisma db push refuses to drop it automatically.
DROP TABLE IF EXISTS "public"."avatar_drafts" CASCADE;
