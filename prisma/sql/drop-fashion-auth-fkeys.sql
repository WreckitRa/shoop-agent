-- Drop cross-schema FKs to auth.users so Prisma can manage public tables
-- without declaring the auth schema (which would make db push try to drop
-- Supabase Auth tables). user_id columns + RLS remain the access guard.

alter table public.people
  drop constraint if exists people_user_id_fkey;

alter table public.fashion_facts
  drop constraint if exists fashion_facts_user_id_fkey;

alter table public.style_signals
  drop constraint if exists style_signals_user_id_fkey;

alter table public.request_events
  drop constraint if exists request_events_user_id_fkey;
