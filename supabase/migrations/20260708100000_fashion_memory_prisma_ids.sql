-- Prisma Conversation/Message ids are cuid strings, not Postgres uuids.
-- Store them as text so request_events + extraction_runs can reference chat rows.

alter table public.request_events
  alter column conversation_id type text using conversation_id::text;

alter table public.extraction_runs
  alter column conversation_id type text using conversation_id::text;

alter table public.extraction_runs
  alter column last_message_id type text using last_message_id::text;
