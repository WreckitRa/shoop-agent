-- Canonical matching key for style_signals. Raw phrase stays in value.
ALTER TABLE public.style_signals
  ADD COLUMN IF NOT EXISTS value_canonical TEXT;
