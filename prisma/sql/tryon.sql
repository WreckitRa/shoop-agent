-- Try-on tables (also in supabase/migrations/20260713140000_tryon.sql)

ALTER TABLE public."UserProfile"
  ADD COLUMN IF NOT EXISTS tryon_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tryon_outfits_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tryon_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  provider text NOT NULL,
  input_refs jsonb NOT NULL DEFAULT '{}',
  output_url text,
  output_path text,
  ms int,
  cost_estimate real,
  status text NOT NULL DEFAULT 'pending',
  error text,
  search_id text,
  product_ref text,
  avatar_version text,
  look_id text,
  step_index int,
  parent_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tryon_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, user_id)
);

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS avatar jsonb,
  ADD COLUMN IF NOT EXISTS avatar_source_photo_path text;

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
