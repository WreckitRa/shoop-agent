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

## Layer ownership (patch discipline)

When a find is wrong, ask which layer failed — do not stack another defense:

1. **Eligibility** (`hard-drops`) — wrong family/subtype in the bench → expand taxonomy + item-type predicates (never Sonnet prompt bans).
2. **Availability** (hydration + presentation) — only verified items on the live rack; unverified overflow is not a find.
3. **Composition** (`presentation` / `composition-invariants`) — headers from contents; short/empty benches get honest thin notes; no junk-fill.
4. **Observability** — hard_drops events carry `rejection_samples` so diagnosis is by predicate, not screenshot.

Shopify Catalog MCP is query-time; we do not run an offline identity warehouse. Treat title/taxonomy hard drops as the practical identity gate.
