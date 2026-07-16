# Fashion path doctrines

## Four-line judgment / consequences

1. **Decide from knowledge you have** — stated conversation facts and profiles count immediately.
2. **Ask only for blocking gaps** — nice-to-haves may ride along, never drive a turn alone.
3. **Overrides require better information** — code may override the LLM only with conversation-derived or strictly richer data.
4. **Fallbacks share the happy path** — every recovery path exits through the same validators and pool state.

## Information-asymmetry rule

Guards that override LLM judgment must consume conversation-derived data (`stated_facts`, clarification ledger). DB-only evaluation that ignores what the user just said is a doctrine violation. Identity-gate builders take a merged view (DB + stated_facts); `filterQuestionsSatisfiedByFacts` is defense-in-depth.

## Choke-point rule

Every fallback path exits through the same validator / pool state as the happy path:

- Plans → `finalizeResolvedPlan` (clamps + invariants + budget)
- Queries → `validateSlotQueryVariants` (LLM and deterministic rebuild)
- Clarifications → sanitize + dedup
- Curation picks → `validateCurationOutput` (including deterministic fallback via `validateAndRepairFallback`)
