-- Avatar drafts were removed from the Prisma schema (avatar rework) but may still
-- exist on live DBs with rows. `prisma db push` refuses to auto-drop non-empty
-- tables, so drop explicitly before push. Recreated after push in avatar-drafts.sql
-- for the Supabase-client draft store (not managed by Prisma).

DROP TABLE IF EXISTS public.avatar_drafts;
