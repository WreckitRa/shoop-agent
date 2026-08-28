-- Avatar draft progress store (Supabase client, not a Prisma model).
-- Applied after `prisma db push` so Prisma does not try to drop it as an orphan.

CREATE TABLE IF NOT EXISTS public.avatar_drafts (
  person_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  step text NOT NULL DEFAULT 'upload',
  photo_path text,
  attributes jsonb,
  preview_url text,
  preview_path text,
  preview_variants jsonb,
  selected_provider_key text,
  regen_count int NOT NULL DEFAULT 0,
  minor_refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_drafts_user_id ON public.avatar_drafts(user_id);

GRANT ALL ON TABLE public.avatar_drafts TO postgres, service_role, anon, authenticated;

-- PostgREST caches the public schema; without this, new tables 404 as missing.
NOTIFY pgrst, 'reload schema';

