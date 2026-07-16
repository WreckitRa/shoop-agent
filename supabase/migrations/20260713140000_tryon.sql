-- Virtual try-on: avatar on people, drafts, generations, feedback

ALTER TABLE public."UserProfile"
  ADD COLUMN IF NOT EXISTS tryon_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tryon_outfits_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS avatar jsonb,
  ADD COLUMN IF NOT EXISTS avatar_source_photo_path text;

CREATE TABLE IF NOT EXISTS public.avatar_drafts (
  person_id uuid PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step text NOT NULL DEFAULT 'upload',
  photo_path text,
  attributes jsonb,
  preview_url text,
  preview_path text,
  regen_count int NOT NULL DEFAULT 0,
  minor_refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_drafts_user_id ON public.avatar_drafts(user_id);

CREATE TABLE IF NOT EXISTS public.tryon_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('avatar', 'single', 'outfit_step', 'outfit')),
  provider text NOT NULL,
  input_refs jsonb NOT NULL DEFAULT '{}',
  output_url text,
  output_path text,
  ms int,
  cost_estimate real,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
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

CREATE INDEX IF NOT EXISTS tryon_generations_person_id ON public.tryon_generations(person_id);
CREATE INDEX IF NOT EXISTS tryon_generations_user_id_created ON public.tryon_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tryon_generations_cache ON public.tryon_generations(avatar_version, product_ref, status)
  WHERE kind IN ('single', 'outfit') AND status = 'completed';
CREATE INDEX IF NOT EXISTS tryon_generations_parent ON public.tryon_generations(parent_job_id);

CREATE TABLE IF NOT EXISTS public.tryon_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES public.tryon_generations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, user_id)
);

CREATE INDEX IF NOT EXISTS tryon_feedback_generation ON public.tryon_feedback(generation_id);

-- Per-user daily generation cap tracking uses tryon_generations rows.
-- Feature flags live on user_profiles (Prisma-managed).
