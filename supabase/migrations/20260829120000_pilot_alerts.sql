-- Ops table: day-one P0s that must not stay in logs-only.
-- Service role writes; RLS on with no policies (anon/authenticated cannot read).

create table if not exists public.pilot_alerts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  severity    text not null default 'P0',
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists pilot_alerts_created_at
  on public.pilot_alerts (created_at desc);

create index if not exists pilot_alerts_code_created
  on public.pilot_alerts (code, created_at desc);

alter table public.pilot_alerts enable row level security;
