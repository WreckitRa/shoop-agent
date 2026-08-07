-- Remove PromptRun rows whose kinds are being dropped from PromptRunKind
-- (fashion-only chat no longer records these). Prisma cannot alter the enum
-- while any row still uses a dropped variant.

DELETE FROM public."PromptRun"
WHERE kind::text IN (
  'topic_guard',
  'intent_shift',
  'search_query_planner',
  'search_pipeline'
);
