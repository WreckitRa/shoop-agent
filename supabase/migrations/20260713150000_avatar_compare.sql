-- Avatar draft compare variants (GPT Image vs FASHN face-to-model)

ALTER TABLE public.avatar_drafts
  ADD COLUMN IF NOT EXISTS preview_variants jsonb,
  ADD COLUMN IF NOT EXISTS selected_provider_key text;
