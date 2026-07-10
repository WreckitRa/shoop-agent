alter table public.extraction_runs
  add column if not exists ambiguous_subjects jsonb;
