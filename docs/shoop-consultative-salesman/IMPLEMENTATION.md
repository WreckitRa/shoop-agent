# Shoop consultative salesman — implementation package

Everything here is a full replacement or a new file. Nothing is a diff. Where a
file integrates with code I could not see, the exact hook is named.

## What changed, in one paragraph

The router is no longer a gate that runs at the first legal moment. It is the
salesman: it opens with what it already knows about you (`known_summary`), asks
the one to three questions whose answers change what gets pulled (`kind:"consult"`
— depth, keep-vs-explore, budget band, style lane, color, fit, direction), always
lets you say "You decide" or "Just show me", and declares every call it makes on
your behalf (`assumptions[]`) so the results say them back to you. The planner
honors the agreed depth and anchor instead of guessing. The curator delivers that
depth, names how it honored the anchor, voices every assumption, and closes with
grounded next-step chips. The clerk remembers whether you like being guided or
want speed, and any standing count ("always show me 5"), so next time the
salesman asks less. Code counts rounds, guarantees chips, and never interprets a
chip — the LLM reads the chip as conversation on the next turn.

## Files

| Path | Kind | Integration point |
|---|---|---|
| `docs/fashion/router.md` | replace | `router/prompt.ts` → `ROUTER_PROMPT_STATIC`; the CONTEXT block now ends with the APPOINTMENT line. Re-hash. |
| `docs/fashion/planner.md` | replace | `search-planner/prompt.ts`. Re-hash. |
| `docs/fashion/curation.md` | replace | `curation/prompt.ts` skeleton + mode sections. Mode sections now use `${DEPTH}` / `${LOOKS}` — bind with `bindModeSection()`. Re-hash. |
| `docs/fashion/extraction.md` | replace | `extraction/prompt.ts`. Re-hash. |
| `src/lib/fashion-memory/router/tools.ts` | replace | Tool schemas. Same three tool names. |
| `src/lib/fashion-memory/router/brief-types.ts` | new | Shared `FashionSearchBrief`; `upgradeLegacyBrief()` for old metadata. |
| `src/lib/fashion-memory/intake/consultation.ts` | new | Round counter, APPOINTMENT context, chip guarantees, auto-upgrade rule, gap sanitizer. |
| `src/lib/fashion-memory/router/profile-appointment-lines.ts` | new | Two extra PROFILES lines; extraction gate predicate. |
| `src/lib/fashion-memory/curation/appointment-contract.ts` | new | `agreedDepth`, `bindModeSection`, narration schema additions, assumption-line invariant + repair, next-step fallback. |
| `src/components/chat/FashionConsultation.tsx` | new | Replaces question rendering in `FashionRouterControls.tsx`; adds `NextStepChips`. |
| `src/lib/fashion-memory/fixtures/consultation.test.ts` | new | Nine fixture groups. |

## Wiring (run-fashion-chat-stream.ts), in order

1. **Model.** `FASHION_ROUTER_MODEL` default → `claude-sonnet-5`. Omit `temperature`. Keep escalation env for Opus as-is.
2. **Context.** After `assembleRouterContext`, append `buildAppointmentContext(appt)` to the uncached suffix, after `CURRENT DATE`. Load `appt` from conversation metadata (`MessageMetadata.fashionRouter.appointment`); default `EMPTY_APPOINTMENT`.
3. **Profile formatter.** In `assemble-router-context.ts`, after `signals:` line, push `formatAppointmentLines(signals, facts)`.
4. **Router dispatch.**
   - `ask_clarification` → `const { call, appt: next } = onClarification(raw, appt, userLang)`. Persist `next`. Run existing sanitize/dedup/dodge on `call`. Dodge counting: skip messages where `isResolutionTap(text)` is true. Auto-upgrade only when `mayAutoUpgradeToSearch(call, isSatisfied)`.
   - `ready_to_search` → `upgradeLegacyBrief(raw.brief)`; persist `resetAppointment(brief)`. If `known_summary` present, emit it as the first SSE progress line before "Planning your search".
   - Identity gate and `applyStatedFacts` unchanged; `stated_facts.depth` (lasting) is passed through to the clerk as a `[NEW]` fact, not applied by code.
5. **Planner.** No code change beyond passing the full brief (it already receives the JSON). `finalizeResolvedPlan` underflow-expand must respect `agreedDepth(brief)` when filling support slots.
6. **Curation.** Interpolate mode sections through `bindModeSection(section, brief)`. Add `narrationAppointmentSchema` fields to `deliver_curation`'s narration object (all required except `anchor_line`). Stage B `deliver_curation_voice` gains `assumption_lines`, `anchor_line`, `depth_line`, `next_steps` (required). In `composition-invariants.ts`: `repairAssumptionLines`; if `next_steps` missing → `fallbackNextSteps`. The deterministic fallback (`buildDeterministicFallback`) must also set `assumption_lines = brief.assumptions` and `next_steps = fallbackNextSteps(brief)`.
7. **Render contract.** Bump `RENDER_CONTRACT_VERSION` → 2. `render.narration` carries the four new fields. Client renders `NextStepChips` under results. Chip tap posts the label as a user message (existing path).
8. **Extraction.** `extraction/gate.ts` soliciting predicate → `assistantTurnWasSoliciting(prevMeta)`. Application layer (`applyFashionOps`) accepts `signal_add.category === "shopping_style"` and `fact_add.fact_type === "depth_default"` (value `{value, unit}`); precedence rules unchanged.
9. **Observability.** New `recordPipelineEvent` fields on the router event: `consult_rounds_used`, `consult_gaps_asked[]`, `resolution_tap` (bool), `assumptions_count`. Dashboard: consult questions per brief (target median 1, p90 2), "You decide" rate per gap, escape rate, re-ask violations (must be 0), assumption-lines-voiced rate (must be 100%).

## Doctrine updates for the packet

Replace §4.4 and §4.5 with router.md P1–P7 and the CONSULTATIVE section. Add to
§2 layer table: L2 also owns `depth`, `preference_anchor`, `assumptions`. Add to
"Illegal fixes": deriving any brief field from chip text in code; skipping a
consult question by code; padding to agreed depth.

## What I deliberately did not do

- No fourth tool, no free-text path. The salesman voice lives in `reply`, `known_summary`, `assumption_lines`, `next_steps`.
- No keyword detection of speed signals, chip meanings, or request_type. `isResolutionTap` only matches the exact chip labels the UI itself rendered, for dodge accounting; meaning is still the LLM's.
- No change to identity gate, hard drops, hydration, scoring, never-skip Stage A.
- Deterministic chip localization covers en/fr/ar/es as a seatbelt only; the LLM writes the chips.
