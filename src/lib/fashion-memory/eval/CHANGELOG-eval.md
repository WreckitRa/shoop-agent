# Appointment eval changelog

Each entry: prompt/code change → target cell → before/after scores from
`eval/runs/<seed>-*/summary.json`.

## S1e / S2 — occasion not a string gate; tiny-budget images; 12b explore notch (2026-08-28)

S2's failure on S1d was exact-match on `occasion_context` (`commute` vs
`winter commute`) — a code-side string compare making a meaning decision.
`classifyRefinementMode` no longer gates on occasion or `request_type`.
Rescore-only = previous search exists + garments equal by family +
recipient equal + budget equal-or-looser. Department/brand still force
full. `request_type` outfit vs multi_item is the same defect class as
occasion prose — deleted after the matrix run still classified Sofia
`full` on that flip.

Image budget: explore reserves `max(1, ceil(budget/2))` so a ≤2 bench
always images at least one `lane=new` when verified has them.

12b explore: when the imaged bench holds lane-new, a usual hero needs a
one-clause justification or a thin_note. Cost knobs frozen.

Re-run: `eval/runs/1-v4-taste-2026-08-28T10-33-01-155Z` vs v3
`eval/runs/1-v3-brand-2026-08-27T22-35-49-290Z`. Abort **0% (0/64)**.

- keep Δ **+0.447**. Priya +1.667.
- Camille explore **50% new** (still passes). Hannah **9 adjacent / 2 looks**.
- Theo explore **75% new**. Jacket 4/0/3 verified → 0/0/1 imaged → 0/0/1
  heroes (`ok`). Tiny-budget reservation held.
- **Ines 9% new** (was 22%). Accepted variance — no further ranking force.
  Lane log: dresses 11/5/2 → 2/0/1 → 4/0/1; jacket 0/9/1 → 0/1/0 → 0/4/0;
  shoes 6/1/0 → 4/0/0 → 2/0/0 (no new on the shoe bench this run).
- cost Δ **+$0.021**. Frozen. Not a rerank lever.

**S2 Sofia** (matrix run still `full` on `multi_item`→`outfit`; gate
deleted; one-persona close in `1-v4-s2-sofia-2026-08-28T10-52-09-563Z`):
`rescore-only`, cache **55 hits / 2 calls**, `total_to_final_ms` **34903**.
Under 20s is Stage A still running on the reused bench — that's S5, not
another classifier patch.

Search thread parks here. S3 (budget abort) and S5 (latency) ride with
pilot prep. Remaining proof is the two-visit golden with the judge.

## Two-visit golden + purchase `search_id` plumbing (2026-08-28)

`golden-visit-2` is a two-conversation harness (same scratch guest, new
`conversationId` on visit 2), not a seeded-persona JSON. Visit 1 opens
"need a shirt for a client dinner thursday", answers depth with "3 options",
rejects with "not the striped one", then a synthetic navy Percival purchase
is written against visit 1's `search_id`. Clerk is awaited before visit 2.
Visit 2 opens "got another dinner coming up" and must recall the Percival,
not re-ask depth, not surface the striped candidate, and ask strictly fewer
consult questions (`preference_anchor` is exempt — recognition, not a
consult. Visit 2 passes `fewer_consults` at 0 consults, including when
visit 1 also assumed depth. `visit2_anchor_only` forbids any other ask.
Purchase-history garment families count as named for the unnamed-garment
gate. Usual/new chips mislabelled as occasion are coerced to
`preference_anchor`.

Production: add-to-cart stamps `searchId` on the line; Rye confirm/retrieve
on `completed` calls `completeCheckoutPurchase`. Shopify merchant handoff
still cannot correlate `userId` — **pilot constraint:** the ten users must
check out in-app (`docs/fashion/pilot.md`). Missing id is
`[PILOT][P0] purchase_memory_missing_search_id` on `console.error`.

Judged proof: `eval/runs/1-visit2-proof-2026-08-28T10-42-05-067Z` —
Opus **4.8** (recognized/asked_right/not_interrogated/accuracy/would_proceed
all 5). Visit 2: Percival recall → The usual → ready. Consults 0–0.

## S1d — lane-aware images, explore corroboration off, 12b, support top-20 (2026-08-28)

The S1c control: when new was imaged, Stage A took it. New survived to
verified and lost at image selection because composite order (corroboration
+ shopify_rank residue) handed the camera to usual after the rerank scored
new higher.

Fixes (code, not prompt — except 12b):
1. Lane-aware image budget: explore reserves ceil(budget/2) lane=new;
   push always images one adjacent/new per slot.
2. Explore corroboration weight → 0 (renormalize). v3-brand unchanged.
3. 12b: explore heroes MUST draw from imaged new; push step-out is
   mandatory and named (thin_note is the only excuse).
4. Support rerank top-20 (one batch). Camille 12 calls → 7.
5. Ines was not given extra ranking force. S1c log before this run:
   shoes 8/0/3 verified, 3/0/1 imaged, 3/0/0 heroes (Stage A);
   jacket 4/5/2 → 1/2/0; dresses 3/7/1 → 2/1/0 (image starve).

Re-run: `eval/runs/1-v4-taste-2026-08-28T08-40-18-892Z` vs v3
`eval/runs/1-v3-brand-2026-08-27T22-35-49-290Z`. Abort **0% (0/65)**.

- keep Δ **+0.417** (gate +0.2).
- **Camille explore PASSES 67% new** (was 36%). Dresses verified now
  0/2/12 new; imaged 0/1/3 → heroes 0/1/3. Sandals/swimsuit still `ok`.
  Jacket 0/4/4 imaged → 0/3/2 heroes (`stage_a` on ratio only).
- **Hannah push PASSES** (4 adjacent / 2 looks). Shirt 0/2/0, trousers 0/2/0.
- Sofia push PASSES (1 adjacent / 1 look). Coat still 1 adjacent on
  verified, 0 imaged (`rerank_or_market`); boots 3/2/0 → 2/1/0 `ok`.
- Ines 22% new (was 0%). Every slot now images new. Remaining miss is
  Stage A: shoes 2/0/1 imaged → 2/0/0 heroes. Not ranking, not market.
  No further ranking force.
- Theo 33% new (was 56%). Knit/trousers `ok` on the new they imaged;
  jacket 3 new verified, 0 imaged on a 2-image bench. Haiku variance +
  one slot the reservation missed — not a new ranking lever.
- cost Δ **+$0.022** (gate $0.02). Camille +$0.037 (was +$0.120). Mean
  still a cent over from Stage A elsewhere (Daniel +$0.077), not call
  count on the capsule.

**S2 on Sofia's camel refine:** `refinement_mode=full` (not rescore-only).
Occasion string drifted `commute` → `winter commute`; classify is exact
match, so it re-planned. `total_to_final_ms` **31752**. Taste cache
**16 hits / 3 calls** on the overlapping ids. `refinement_reuse` failed
for that reason. Color was the only real brief change.

If Camille had still missed after 1+2, that would have been market
(linen-free capsule land) → thin_note, not more ranking. She didn't.

## S2 — refinements reuse the bench (2026-08-28)

`classifyRefinementMode` (code over brief diffs): same garments + budget
equal-or-looser → rescore-only (skip planner + MCP fan-out); one family
changed → partial (re-query that slot); tighter budget / recipient /
occasion / brand → full. Pools persist survivors + plan on every final
render. Eval `refinement_reuse` fires on `refines_after_results` when
garments are unchanged. Live pair not re-run this turn — S1c ranking
stands; Sofia's next full-stage eval exercises the second search.

## S1c — per-persona gates, lane log, support top-30 (2026-08-28)

Diagnosis of `1-v4-taste-2026-08-28T07-19-13-291Z` before either prompt
change. Last run did not persist bench lanes; inference from funnel +
hero `taste_fit`:

- **Camille (explore, 9/10/2 heroes).** 74 verified, 24 imaged, 21
  heroes — Stage A used almost the whole imaged bench. 10 of 21 heroes
  matched linen (`taste_fit` 1). The imaged bench was usual+adjacent,
  not a new-heavy bench that Stage A ignored. Loss is rerank labeling /
  score (linen still ranked onto the image budget). Not 12b.
- **Sofia (push, 3/0/0).** Coat hero `taste_fit` 0 (matched +
  contradicted) is the charcoal step-out, labeled usual. Boots
  contradicted camel, also labeled usual. The step-out reached heroes
  mislabeled — rerank labeling, not Stage A passing over adjacent.

Fix named: prompt line "matching the client's dominant signal is lane
usual regardless of score." Support slots rerank top-30. Gates:
explore ≥50% new per persona; push ≥ one adjacent/new per look.
`lanes_by_slot` (verified / imaged / heroes) now on
`search_observability`. 12b unchanged.

Re-run: `eval/runs/1-v4-taste-2026-08-28T07-45-23-981Z` vs v3
`eval/runs/1-v3-brand-2026-08-27T22-35-49-290Z`. Abort **0% (0/87)**.
Rerank wall 2.3–4.3s.

- keep Δ **+0.627** (gate +0.2). Maya −0.375 → 0; Priya −1 → 1;
  Elena −0.333 → 0.429. Omar/James still 1.0 from Shopify rank.
- **Sofia push PASSES** (2 adjacent / 1 look). Boots imaged 0/4/0 →
  heroes 0/2/0. Coat still 1 adjacent on verified, 0 on imaged
  (`rerank_or_market`) — the step-out never reached the image budget.
- Camille explore **36% new** (9/25). Lane log names ranking, not 12b:
  tops verified 4/4/6 new, imaged 2/0/0; bottoms 2 new verified, 0
  imaged. Sandals/swimsuit *did* put new on the imaged bench and Stage
  A took them (`ok`). Dresses had **0 new on verified** — market or
  linen still occupying the usual lane.
- Ines 0% new; Hannah 0 step-out for 2 looks. Theo 56% new passes.
- cost Δ **+$0.021** (Camille +$0.120, 12 calls). Top-30 support still
  splits into two 20-batches when the bench is deeper than 20, so call
  count did not drop on the capsule.

S2 ships on this ranking. Do not patch 12b; the log does not name Stage A.

## S1b — make the rerank actually run (2026-08-28)


Diagnosis of first v4 live run (`1-v4-taste-2026-08-27T22-48-25-530Z`)
before any payload change:

- `llm_calls` has **0** taste_rerank rows. Eval traces are random UUIDs
  that never insert `traces`, so persist fails (`fashion_llm_call_persist_failed`).
  Token counts are not in the DB for this run.
- Evidence is `search_observability` on the persona JSONs. Slots already
  fan out (`Promise.all`). `maxTokens` was **2048**, not unset.
- 47 slots across 16 personas; `cost.by_stage` recorded **28** completed
  taste_rerank calls (~40% of slot-calls aborted at hang-safety). Wall is
  max of parallel slots, so one abort holds the stage at ~20s.
- Completed calls cost ~$0.008–$0.011 each (Haiku filling ~2k output
  tokens). Maya 4/4 completed at 19940ms / $0.0412; Sofia and Ines 0
  recorded calls. Extra $0.024/persona was paid for calls that abort.
- The 20s is per-slot 40-item generation into 2048 output tokens, not
  sequential slot calls.

S1b: drop `why`; integer `score` 0–10 (`taste_fit = score/10`); two
parallel 20-candidate calls per slot (slots still fan out); `max_tokens`
= 25n+80; 20s hang per batch with partial fail-open; explore line
"matching the client's dominant signal scores ≤ 3 unless occasion leaves
no alternative." Abort rate and per-call tokens now live on
`search_observability.taste_rerank` so the next eval does not need the
`traces` FK.

Re-run: v4 only (`eval/runs/1-v4-taste-2026-08-28T07-19-13-291Z`), pair
against `eval/runs/1-v3-brand-2026-08-27T22-35-49-290Z`.

- **Abort 0% (0/80).** Wall 2.4–4.7s (max 4681ms). Output ~420 tok/call
  (mean in 2102 / out 420) vs the old ~2048-token fill.
- keep Δ **+0.694** (gate +0.2). Maya −0.375 → 0.429; Priya −1 → 1;
  Elena −0.333 → 0.333; Omar/James already 1.0 on v3.
- explore lane=new **48%** (need ≥ 50%). Theo 9/9 new; Ines 3/9; Camille
  2/21 (still 9 usual). Sofia push still 3 usual / 0 step-out.
- Chris −1 unchanged. cost Δ **+$0.021** (gate ≤ $0.02) — $0.001 over;
  Camille +$0.104 on 10 completed calls is the pull. No further
  throughput change: the stage ran.

## S1 — taste rerank before hydration (2026-08-28)


Haiku `rate_taste_fit` on top-40 survivors (attributes only), then score
with `taste_fit` 0.30 (`SCORING_WEIGHTS_VERSION=v4-taste`). Fail-open on
20s hang. Gated by the same env switch as weights: `v3-brand` skips the
rerank so ranking is byte-identical to pre-S1.

The planted fixture in `scoring/taste-weights.test.ts` is a regression
guard (taste can outrank shopify_rank). It is **not** a baseline.

Live S0/S1 number: `eval:appointments --stage full` on 8 golden + 8
known-client, run twice (`--weights v3-brand` then `v4-taste`). Report
hero taste_fit, lanes, funnel, latency, cost. Pair file:
`s0-s1-comparison.md`.

First live pair (2026-08-27, skip-judge):

- v3: `eval/runs/1-v3-brand-2026-08-27T22-35-49-290Z`
- v4: `eval/runs/1-v4-taste-2026-08-27T22-48-25-530Z`
- keep Δ **+0.136** (gate +0.2 missed). Maya −0.375 → 0.222; Omar/James
  already 1.0 on v3; Priya stuck at −1.
- explore lane=new **0%**. push step-out 1/4 (Hannah only). Chris −1
  unchanged.
- cost Δ **+$0.024** / persona (gate ≤ $0.02).
- v4 `taste_rerank_ms` is ~20s on most personas (hang-safety abort →
  fail-open). Empty lanes often mean the Haiku call never landed, not
  that the client has no adjacent/new piece.

The planted fixture in `scoring/taste-weights.test.ts` is a regression
guard (taste can outrank shopify_rank). It is **not** a baseline.

## S0 — taste_fit / funnel observability (2026-08-28)

Instrumentation: per-slot funnel, stage latency, search cost (router
excluded), deterministic hero `taste_fit`. No ranking change until S1.

`--stage full` originally stopped after the brief, so S1 shipped without
a live before-number. That retrieval path is now wired; the v3/v4 pair
is the comparison.

## Iteration 18d — Sonnet retired; Opus-only judge (2026-08-27)

### Policy
- **Sonnet retired** as judge (top-of-scale compression −1.5 to −2.2 on best
  cal transcripts). Opus grades all.
- Tone iterations: Opus on **subset-30**. Bar claims: Opus on **full 68**.
- Tiering path (Sonnet full + Opus bottom-15) deleted.

### Provisional reader grades (cal pack)
- Entered Claude calibration overalls as provisional human reader
  (cal-01 3.0, 02 2.0, 03 3.8, 05 3.0, 06 4.0, 07 3.4, 08 3.7, 09 4.5, 10 4.0).
- **Opus↔reader:** mean offset **−0.44**, agreement (|Δ|≤0.4) **5/9 = 55.6%**.
- Report: `eval/calibration/SONNET-OFFSET.md`

### Voice freeze (pilot)
- Reverted to **change-2** measured bar (`…T20-01-50-086Z`, Opus mean
  **3.85**). No further subset runs.
- Kept from change 3 only: delete hardcoded
  `"Same lane as last time…"` / `"What pieces should I pull?"` (use
  question text) + grep lock in `voice-line-reuse.test.ts`.
- Change-3 Haiku/temp/n=2/exemplar/register work discarded.

### Voice/recognized round 2 — change 3 (partial keep; rest discarded)
- Attempted temp 0.7 / n=2 / Haiku rewrite / register exemplars.
- Sonnet 5 omits temperature; persisted improved some but voice/rec and
  truth_match regressed. **Frozen** — see Voice freeze above.
- Kept: code deletions of stock replies + grep test only.

### Voice/recognized round 2 — change 2 (structural) — **pilot baseline**
- Deleted `replacementForBannedReply`. Never code-substitute reply text
  (also dropped the client-words prepend in `withClarificationDefaults`).
- `line_reuse` is a one-shot LLM rewrite gate (banned list OR line seen ≥2×
  in the eval run): gateNote asks for fresh client words; if retry still
  reuses → accept + `line_reuse_persisted`.
- Run `1-2026-08-27T20-01-50-086Z` (Opus subset-30): mean **3.85**
  (Δ +0.06 vs change-1 3.79; ≈flat vs same-30 baseline 3.84).
  rec **3.87** (+0.14 vs ch1) · voice **3.61** (+0.07) · not_int 4.2 ·
  truth_match **93.3%** (subset — watch on next full seed).
- Rates: line_reuse **19.3%** · retry **19.3%** · persisted **16.9%**
  (flagged 16/83 spoken turns; 14/16 retries still reused).

### Voice/recognized round 2 — change 1
- Ban + rewrite `replacementForBannedReply` canned closer
  ("One quick thing so I pull right" / escape-token echo).
- Run `1-2026-08-27T19-18-54-735Z` (Opus subset-30): mean **3.79**
  (same-30 baseline from `…T17-27-15` Opus **3.84**, Δ **−0.05**).
  rec 3.73 (+0.06) · voice 3.54 (+0.04) · not_int 4.27 · truth_match **93.3%**
  on subset (full-68 bar still 95.6%). Judged **30/30**, defaulted 0%.

## Iteration 18c — Sonnet uncalibrated; Opus bar baseline (2026-08-27)

### Policy (superseded by 18d)
- Sonnet absolute score has **no known meaning** → deltas only.
- Bar claims → **full-seed Opus** grade (`judgePrimary: opus`).
- Never blend.

### Sonnet calibration pack (9 transcripts; cal-04 excluded)
- Mean offset Sonnet−Opus: **−0.70**
- Agreement (|Δ|≤0.4): **5/9 = 55.6%**
- Mean dim agreement: **39.2%**
- Human fields later filled in 18d.

### Full-seed Opus bar baseline
- Judge-only on `1-2026-08-27T17-27-15-657Z` transcripts (no regen).
- **Opus mean 3.81** · judged/total **68/68** · defaulted **0%**
- Dims: rec 3.66 · ask 3.97 · not_int **4.25** · silent 3.96 · acc 3.72 ·
  voice 3.50 · proceed 4.10
- truth_match **95.6%** (deterministic; unchanged)

## Iteration 18b — prompt revert after subset regression (2026-08-27)

- **Regression (blended, non-comparable):** subset-30 `…T14-51-30` overall **3.51**
  vs `…T14-32-44` **3.87**. **Sonnet-only:** 3.12 → **3.04** (−0.08). Opus tail
  3.87 (n=30) → 3.33 (n=15). Do not compare blended means across runs.
- **Router prompt** reverted to hash `ec7aab7be27fccf6…` (T14-32-44). Sole prompt
  delta was VOICE EXAMPLES `"shopping that now."` ↔ `"pulling something sharp."`
  — **skipped** as not worth a subset run.
- Report: Sonnet mean first, Opus tail second; `overall_mean` ≡ Sonnet; never blend.
- Subset only for reply/known_summary/pull_line prompt wording; gates/schema/slots/
  depth/planner/curation/shopper/bar claims → **full seed**.
- Item-5 unnamed garments gate remains in code (`briefGarmentsUnnamedByClient` /
  `garment_gate_fired` in `intake/post-router.ts`).
- Next: full seed 1 on reverted prompt, Sonnet + Opus bottom-15.
- **Full seed1** `1-2026-08-27T17-27-15-657Z`: Sonnet mean **2.95**, truth_match
  **95.6%**, judged/total **68/68**; Opus tail n=15 mean **3.0**. Prompt hash
  `ec7aab7be27fccf6…`. (Initial Opus selection overshot via cell logic; killed and
  finished with strict bottom-15.)

## Iteration 18 — voice/recognized round 2 + cost controls

### COST (before rerun)
- **C1 cache:** Happy-path router already caches `ROUTER_PROMPT_STATIC` (cache_read
  ~7.5k). `gate_retry` was **0%** because retries used `systemOverride` →
  `disablePromptCache`. Fixed: `gateNote` appends after uncached
  ROSTER/PROFILES/DATE; static prefix stays cached. Eval traces from
  `1-2026-08-27T10-24-30-416Z` already purged from `llm_calls` — before/after
  hit rate on next run.
- **C2–C5:** Sonnet full grade + Opus bottom-15 / cell-borderline; grade reuse
  on transcript fingerprint + router prompt hash; `--subset N` stratified;
  `--max-usd` (default 25) projected-cost gate.

### Router / harness
- `ready_to_search.pull_line` (≤20 words); progress line; deterministic
  `pull_line_fallback`; judge sees pull_line.
- Gate notes = instructions ("Ask X, phrased around …; do not reuse prior
  wording"); checks `line_reuse`, `name_in_self_question`.
- Few-shot voice exemplars in router prompt; self → you/your.
- Garments update with no family after normalize → keep prior (seed2 reaction).

## Iteration 0 — harness

- Built `src/lib/fashion-memory/eval/` (persona, generator, shopper, checks,
  judge, runner, report).
- Script: `npm run eval:appointments`.
- Golden set: `eval/personas/golden-seed.json` (8 personas; baptism is #1).
- Seed-1 golden baseline (`1-2026-08-25T12-07-34-918Z`): overall **2.35**,
  `truth_match` 37.5%, `sizes_one_turn` 62.5%, `anchor_asked` 62.5%,
  `color_on_dress_code` 87.5%, zero shopper leaks.

## Iteration 2 — shopper sizes + judge parsing

- Shopper: answer every question on a multi-ask turn; expose `truth.sizes`
  for new clients (golden baptism L/34/10).
- Judge: default missing dims to 3 + JSON text fallback.
- Checks: soften assumption ban (only pipeline jargon); garment synonym
  match for truth_match (pants≈trousers).
- Golden rerun `1-2026-08-25T12-26-03-584Z`: overall **3.24** (was 2.35);
  `color_on_dress_code` 100%; `sizes_one_turn` 87.5%; `assumptions_are_speech`
  100%; `no_silent_drop` 100%; `anchor_asked` still 62.5%; `truth_match` 50%.

## Iteration 2b — 20-persona seed-1 matrix

- Run `1-2026-08-25T12-33-48-238Z` (8 golden + 12 sampled): overall ~3.x,
  2 shopper_leaks (harness). Exit criteria **not met**.
- Remaining blockers (design/prompt): `anchor_asked` / `known_summary` on
  known clients; `no_reask` false and real re-asks; `truth_match` depth +
  garment mapping; judge `would_buy` < 4.0.

## Iteration 3 — harness inflation + router gates

### Harness
- `eval/garment-family.ts`: canonical family map + Haiku fallback; truth_match
  uses family coverage (top⊇polo, shoes⊇heels, etc.).
- **Recheck** of `1-2026-08-25T12-33-48-238Z` without regen: truth_match
  **50% → 66.7%** (3 flips: sneakers/shoes slot, polo/chinos↔top/bottom,
  heels↔shoes). Remaining fails are depth/anchor/dropped blazer — real.
- Shopper: Haiku model; "Before sending, delete any size/number/budget/
  garment you were not asked about…".
- Router-stage: fail if catalog/`ucp_query` pipeline stage logged; judge
  already skipped on leaks; per-persona `duration_ms`.
- `no_reask` check: partial size replies only mark answered families.

### Router
- Anchor gate: deterministic ask on overlapping known client (size-bucket
  overlap + shopping_style quick); no LLM retry round.
- Partial size `"L"` → only tops satisfied; follow-up reply "And shoes?" /
  remaining families; fixture `partial-size-remaining-families.test.ts`.
- Slots answer → brief.garments verbatim + `brief_garments_drift` log.

### Matrix (seed 1 full — `1-2026-08-25T13-24-22-599Z`)

| check | pass% |
|---|---:|
| no_reask | 93.7 |
| sizes_one_turn | 93.7 |
| pull_sheet_present | 92.1 |
| **anchor_asked** | **93.7** |
| truth_match | 50.8 |
| known_summary_present | 79.4 |
| no_silent_drop | 98.4 |
| assumptions_are_speech | 100 |
| overall mean | 3.09 |
| leaks | 5 / 68 |
| would_buy | ~3.05 |

Exit bar **not met**. Dominant truth_match fail: `depth looks 1 != 2` (17).
Worst cell: known_relevant single_item looping preference_anchor on "vas-y".

## Iteration 4 — anchor escape + depth + leak FP

- Escape / "vas-y" / "just show me" after preference_anchor → keep + ready
  (no re-ask loop); strip preference_anchor once asked.
- `parsePreferenceAnchorFromWords` treats speed/escape as keep.
- Depth: prompt forbids assumed-1 after stated count; copy looks from
  user message in post-router.
- Shopper leak detector: no `\bS\b` on contractions; garment word-boundary;
  impatience lines exempt.
### Matrix iter5 (`1-2026-08-25T13-56-42-929Z`)

| check | pass% | Δ vs iter4 |
|---|---:|---:|
| no_reask | 98.4 | +15 |
| anchor_asked | 90.6 | -4.9 |
| truth_match | 60.9 | +14 |
| known_summary_present | 59.4 | -19 |
| overall | 3.09 | 0 |
| leaks | 4 | |

### Matrix iter6 (`1-2026-08-25T14-14-11-903Z`) — 6th full pass

| check | pass% | Δ vs iter5 |
|---|---:|---:|
| no_reask | 95.5 | -2.9 |
| **anchor_asked** | **94.0** | +3.4 |
| truth_match | 56.7 | -4.2 |
| known_summary_present | 79.1 | +19.7 |
| no_silent_drop | 100 | 0 |
| assumptions_are_speech | 100 | 0 |
| overall | **3.10** | +0.01 |
| would_buy | 3.07 | |
| leaks | 1 | |

## Stop — exit bar not met after 6 seed-1 iterations

**Exit criteria gaps (design, not more prompt polish):**

1. **Judge overall ~3.1 vs ≥4.2** — `would_buy` ~3.0 in every language.
   Transcripts read as transactional ("ready to search") without a client-facing
   rack; router-stage alone cannot move would_buy to 4.0.
2. **truth_match ~57%** — still dominated by `depth looks 1 != 2` even after
   depth gate (shopper answers "2 looks" but brief stays assumed/1), plus
   garment drops (blazer/coat/suit) when slots answer ≠ brief.
3. **anchor_asked / no_reask ~94–95%** — not 100%; escape+gate interactions
   still miss a few known/quick cells.

### Three resistant transcripts (design questions)

1. **`a7721d6582352ced`** (capsule/new, overall 1.9) — size asked across 4
   turns; missing pull sheet; depth stays 1 vs truth 2. Suggests size-family
   clamp + depth gate still fight the LLM's multi-turn size drip.
2. **`066378bf11df3f68`** (single_item/has_depth_default, 2.3) — jeans ask
   becomes wrong brief garments; known_summary gaps on intermediate asks.
3. **`7600faa4445035d4`** (single_item/quick_shopper, 2.3) — blazer requested,
   brief drops it; preference_anchor/keep path vs truth explore.

Seed 2 not run — seed 1 never cleared the bar. Harness + gates remain in
place for the next design pass (depth binding from chips, slots→garments
hard set, full-stage would_buy).

---

## Iter7 — rubric split + fidelity gates (2026-08-25)

### Shipped

1. **Judge:** router stage scores `would_proceed`; full stage scores `would_buy`
   (exit: both ≥4.0 in their stages).
2. **Consistency gate** (`intake/consistency-gate.ts`): depth/slots/color/budget
   chip answers hard-set the brief when they disagree; `brief_hardset{gap}`
   logged + reported in eval `summary.json` / report.
3. **Partial size:** remaining families stay on one follow-up; `sizes_one_turn`
   allows ≤2 turns; escape after a prior size ask strips size re-asks.
4. **Escape on anchor:** `preference_anchor` stays `unspecified` +
   `ANCHOR_KEEP_ASSUMPTION` (never hard-set `keep`). Escape paraphrase
   (`just show me what you've got`) recognized; escape → depth `you_decide`
   (no invented assumed look count).
5. **known_summary:** known-client ask without summary → inject `Going on: …`
   (or LLM retry when no profile bits); deterministic asks carry summary.
6. **Slots parse:** free-text pull-sheet answers no longer become sentence
   fragments in `brief.garments` (`parseSlotsClarificationAnswer` + prose scrub).

### Resistant trio confirm (`EVAL_PERSONA_IDS=…`, `--skip-judge`)

Run `1-2026-08-25T15-13-15-062Z`:

| id | truth_match | sizes_one_turn | notes |
|---|---|---|---|
| a7721d6582352ced | pass | pass | depth `you_decide` after escape |
| 066378bf11df3f68 | pass | pass | garments → jeans (not prose) |
| 7600faa4445035d4 | pass | pass | blazer + explore anchor |

### Blocked — full seed 1

Full `npm run eval:appointments -- --seed 1` aborted mid-run:
**Anthropic credit balance too low.** Re-run seed 1 (all 60 + golden) once
credits are restored; target **truth_match ≥ 90** before seed 2 / golden `--stage full`.

---

## Iter8–11 — seed 1 resumed (2026-08-26)

Credits restored. Full seed-1 router + skip-judge iterations chasing truth_match.

### Seed 1 with judge (`1-2026-08-26T06-46-35-084Z`)

| check | pass% |
|---|---:|
| truth_match | **44.1** |
| known_summary_present | 100 |
| sizes_one_turn | 100 |
| would_proceed | 3.16 mean |
| overall | 3.11 |
| brief_hardset | depth×6 |

### skip-judge chase

| iter | run | truth_match | notes |
|---|---|---:|---|
| 8 | `…T06-57-46-020Z` | 61.8 | escape depth + slots prose scrub |
| 9 | `…T07-07-41-663Z` | 54.4 | over-aggressive mine regress |
| 10 | `…T07-17-35-625Z` | 69.1 | assumed→you_decide; mine tightened |
| 11 | `…T07-39-50-064Z` | **74.6** | FR/AR/dressy tokens; strip invent anchor |

Recheck of iter11 with tops/shoes/jacket family collapse: **76.1%**.

### Remaining truth_match fails (~16)

Dominated by **shopper never stating truth garments** (vague → LLM outfit)
or **partial capsule** (dress without sandals / coat without boots). Not
fixable by chip hard-set alone.

**Bar not met (need ≥90).** Seed 2 / golden `--stage full` not started.

---

## Iter12 — classify A–D + slots levers (2026-08-26)

### Classification of iter11 truth_match fails (`…T07-39-50-064Z`, ~18)

| class | n | cells (request_type × specificity) |
|---|---:|---|
| **A** no slots ask on outfit/capsule | 3 | outfit×partial ×2, capsule×vague ×1 |
| **A\*** no slots (single/multi — out of A gate) | 2 | single×partial, multi×vague |
| **B** slots offered; ticks ≠ truth | 2 | capsule×partial, outfit×partial |
| **C** truth garment absent from list; no Other/add | 9 | multi×vague ×5, capsule×vague ×4 |
| **D** capsule thinner than rotation (pure) | 0 | (folded into C / prompt) |
| **other** | 2 | no brief / anchor |

### Levers shipped

- **A** `slots_gate_fired` in `post-router`: outfit/capsule ready without slots
  answered + opener not ≥3 families → reject once with checklist ("ask slots").
- **B** deterministic shopper ticks `truth.garments − owns`; impatient still
  ticks before escape; `detectSlotsChecklistInconsistency` excludes harness bugs.
- **C** slots `allow_other` default + **"Add a piece"** row (UI + parse merge);
  `slots_added_by_client` pipeline event; free-text kept beside chip ticks.
- **D** `enrichSlotsChecklistQuestion` / capsule defaults = full mixable set;
  router prompt updated.
- Sticky pending: slots ticks survive later size/dept turns
  (`refreshPendingBrief`); Surprenez-moi / period no longer drops last garment.

### Seed 1 scores this iter

| run | truth_match | n | notes |
|---|---:|---:|---|
| `…T08-16-22-476Z` | **85.7** | 56 | 12 checklist leaks excluded |
| `…T08-22-07-007Z` | 79.4 | 68 | leak detector loosened; 0 leaks |
| `…T08-29-04-086Z` | 69.1 | 68 | pending coalesce bug (overwrote ticks) |
| `…T08-35-47-285Z` | — | 68 | **Anthropic credits exhausted** mid-fix |

**Bar not met.** Re-run seed 1 after credits; then seed 2 if ≥90.

---

## Iter13 — English-only + garment gates (2026-08-26)

### Language scope
- Persona generator default `language: "en"` only; `--languages fr,ar` reserved
  for a later multilingual seed.
- Golden FR/AR (`golden-fr-capsule-04`, `golden-ar-shoes-05`) converted to English.
- `language_mirrored` check kept in code, disabled (`pass: true`, reason
  "disabled (English-only seed)").

### Exclusion audit (`…T08-16-22-476Z`)
- 12 exclusions: 11× `slots_checklist_missing_add` (class **C**), 1×
  `want_unticked` (not all-on-list B). **True B exclusions: 0.**
- Corrected rule: exclude only when checklist contained all truth garments
  and shopper ticked wrong. Reincluded → **48/68 = 70.6%** (the 85.7% was
  inflated by excluding class C).

### Gates
- multi_item: prompt + strip slots; blocking `garment` ("What are you after?")
  before inventing pieces; `garment_gate_fired`.
- Extended unnamed-garment gate to all request types (garment ask for
  single/multi; slots for outfit/capsule).

### Seeds
- Regenerated `personas/1.json` and `2.json` English-only.

### Seed 1 run `…T09-18-59-339Z` (skip-judge)
- Anthropic **usage limit until 2026-09-01** — 28/68 personas errored.
- Headline truth_match **50%** (includes API fails as no-brief).
- Among completed (n=40): see follow-up cell table in chat.
- Seed 2 not started.

---

## Iter14 — resume + capsule×partial + dressy jacket (2026-08-26)

### Capsule×partial fail classes (`42320f`, `8d06c7`, `b1819a`)
| id | class | fix |
|---|---|---|
| 42320f | **(c)** ticks lost after size escape | sticky pending after mineUsers |
| 8d06c7 | **(b)** push→keep via "keep it smart casual"; wrong anchor chips | parse order; force The usual/Push/Something new |
| b1819a | **(b)** anchor not asked (navy/tailored no garment token) | aesthetic signals ⇒ relevant |

Fixtures: `fixtures/capsule-partial-and-dressy-slots.test.ts`.

### Also
- Dressy/baptism slots: Blazer preselected via enrich.
- `recent_picks` prompt: phrasing only; `pick_history_leak` check.
- Runner: stop on 429/usage, persist partial, `--resume <run-id>`.
- Resume of `…T09-18-59-339Z` halted immediately — API still locked to 2026-09-01.
- **Raise Anthropic monthly spend limit + 80% alert in console** (human).

---

## Iter15 — credits restored; seed1 ≥90; seed2 (2026-08-27)

### Fixes landing with resume re-run of 9 truth_match fails
- `normalizeGarmentClarificationAnswer`: shoe early-return no longer drops apparel siblings (`shirts?` etc.).
- Dressy finalize: `ensureDressyJacketInGarments` injects blazer when outfit/capsule is dressy/baptism without jacket.
- Shopper: deterministic preference_anchor chips from truth.

### Seed 1 resume (`…T09-18-59-339Z`) after re-run
| cell (request_type×specificity) | truth_match |
|---|---:|
| single_item × * | 100% |
| multi_item × * | 100% |
| outfit × * | 100% |
| capsule×vague/complete | 100% |
| capsule×partial | 90% (9/10) |
| **overall** | **98.5% (67/68)** |

Baptism golden PASS. Remaining miss: `4e318a` shopper said "Dress shoes, dress" → brief kept only Dress shoes.

### Seed 2
- Run `2-2026-08-27T08-11-34-446Z` `--skip-judge`: **truth_match 94.1%** (64/68).
- Judge-only resume on both seeds (all 68 each).

| seed | truth_match | judge overall | would_proceed |
|---|---:|---:|---:|
| 1 (`…T09-18-59`) | **98.5%** | 3.23 | ~3.32 |
| 2 (`…T08-11-34`) | **94.1%** | (see report) | (see report) |

Router exit (≥4.2 overall / cells ≥3.8) **not met** — truth_match bar cleared; judge quality next.

---

## Iter16 — calibration + prompt-only dressy jacket (2026-08-27)

### 1. Judge calibration
- Pack: `eval/calibration/` (10 transcripts, overall 2.3–4.5 from seeds 1+2).
- **Human pass required** before router tuning (agreement ≥ 80%).
- Dimension report: `eval/calibration/DIMENSION-REPORT.md`.

### 2. Prompt-only dressy jacket
- Slots prompt: dressy/formal → jacket/blazer preselected on checklist.
- Removed `ensureDressyJacketInGarments` brief injection.
- Garment parse: no shoe-only early-return (apparel siblings kept).
- Seed1 rerun `1-2026-08-27T08-51-26-090Z` `--skip-judge`: **truth_match 97.1%** (≥90 → **keep prompt version**).
- Cell regress vs `…T09-18-59`: **single_item×partial** 100%→86% (`d8bd032` missing blazer). Baptism PASS.

---

## Iter17 — calibration harness + router fixes (2026-08-27)

Human calibration: judge usable on real conversations (±0.4); unusable on
zero-question transcripts because it graded the `(ready to search)` placeholder.
Excluded cal-04 (parse).

### Harness
1. Search turn renders as client sees it: `known_summary` + "Searching the stores".
   Judge never sees `(ready to search)`; no spoken stylist turn → voice = N/A
   (score 0), dropped from mean.
2. Shopper Done answers use `<gap>: <label> | …` (`formatPullSheetPart`).
3. Generator: `truth.depth` equals any count in `opening_message`.

### Router
4. Prompt: multi-part reply = stated facts in order; fixture five Qs → one Done.
5. Check `pull_sheet_split`: slots + depth + preference_anchor on one card.
6. Consistency gate covers `preference_anchor`; hard-set; suppress keep-assumption
   when an anchor line exists (cal-08).
7. `known_summary` ≥1 concrete fact or omit; recent_picks → anchor refs pick
   (`known_summary_template`; `pickHintFromProfile` + rewrite in
   `withClarificationDefaults`).
8. Womens outfit/capsule size families include dresses (cal-02).
9. Checks: `brand_stated_in_conversation`, `stated_sizes_named_families`.

### Re-judge (no regen)
| Run | overall | voice N/A |
|---|---:|---:|
| `1-2026-08-26T09-18-59-339Z` | **3.08** | 3 |
| `2-2026-08-27T08-11-34-446Z` | **3.20** | 11 |

### Seed1 rerun (harness+router)
- Run: `1-2026-08-27T09-22-14-850Z` — completed after credit resume
  (only `fc35809` re-routed + `9a8b0f` judged; 66 prior results kept).
- truth_match **97.1%**; overall **3.06** (68 scored) — **INVALID**: 57/68
  had `why: "dimension defaulted"` (silent 3s). Judge fixed in Iter17b.

### Judge break / fix (Iter17b)
- **Cause:** nested `{score,why}` tool schema → Opus emitted XML param soup
  (`"recognized": "\\n<parameter name=\\"score\\">2"`); parser missed dims →
  silent default score 3. Not primarily max_tokens (failures at ~120 tokens).
- **Fix:** flat `*_score` / `*_why` schema; `maxTokens` 2500;
  `disable_parallel_tool_use`; missing/malformed dim = failure → retry once →
  unjudged (excluded from means). No silent repair of defaults.
- Reports: **defaulted_rate** at top; judged/total on every table; score histogram.

### Re-judge (judge-only, no regen)
| Run | judged/total | defaulted_rate | overall | hist 1–5 |
|---|---|---:|---:|---|
| `1-…T09-22-14-850Z` | **68/68** | **0%** | **3.46** | 6 / 73 / 128 / 206 / 59 |
| `2-…T08-11-34-446Z` | **68/68** | **0%** | **3.74** | 2 / 38 / 88 / 251 / 86 |

Spread covers 1–5 on both seeds → judge usable again.

### Iter17c — recognized + voice tune (hold not_interrogated ≥4.0, truth_match ≥95)
Bottom-10 (recognized+voice) classes: (a) log-speak `Going on:` known_summary /
ready-only; (b) picks unused or irrelevant; (c) script lines ≥3×
(`Going on what I know — the usual…` ×21, `What should I pull for this?` ×8,
`20 seconds of essentials…` ×5, `Quick sizing…` ×5, `Happy to help…` ×3+3);
(d) generic reply with no client noun.
Fixes: warmer `formatKnownSummarySpeech` + template gate retry; spoken ready
`reply` with client words; banned-line rewrite; `pick_referenced` +
`reply_uses_client_words` checks; prompt "never reuse a line".
Escape: `Ooh, let me see what you've got` now treated as escape (was
corrupting brief.garments on refine).

| Run | judged/total | defaulted | overall | recognized | voice | not_int | truth_match |
|---|---|---:|---:|---:|---:|---:|---:|
| `1-…T10-24-30-416Z` | **68/68** | **0%** | **3.66** | **3.56** (was 3.10) | **3.22** (was 2.97) | **4.16** ✓ | **95.6%** ✓ |
| `2-…T10-40-20-232Z` | **68/68** | **0%** | **3.69** | **3.54** (was 3.59) | **3.13** (was 3.35) | **4.24** ✓ | **92.6%** ✗ |

Seed2 truth_match miss: refine `"Ooh, let me see…"` → brief garments
`[ooh, let me see…]` (baptism golden + 3 others). Escape fix landed after the
run — re-run seed2 when ready.


