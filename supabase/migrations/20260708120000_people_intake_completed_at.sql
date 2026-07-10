-- One-time intake gate per person (fashion memory).
alter table public.people
  add column if not exists intake_completed_at timestamptz;
