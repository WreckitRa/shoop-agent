-- Prisma `db push` cannot reconcile cross-schema FKs to auth.users unless the
-- auth schema is declared (and we intentionally do not manage auth.users in
-- Prisma). Drop the FKs; user_id columns + RLS (auth.uid()) remain the guard.
-- Safe / idempotent for re-runs.

alter table public.people
  drop constraint if exists people_user_id_fkey;

alter table public.fashion_facts
  drop constraint if exists fashion_facts_user_id_fkey;

alter table public.style_signals
  drop constraint if exists style_signals_user_id_fkey;

alter table public.request_events
  drop constraint if exists request_events_user_id_fkey;
