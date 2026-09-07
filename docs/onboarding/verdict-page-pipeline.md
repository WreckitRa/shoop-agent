# Verdict page pipeline — agent briefing

> **Audience:** an AI agent that must reproduce, debug, or change the onboarding **verdict card** (`FittingVerdictStep`).  
> **Product:** Shoop Fitting. The verdict page is the reveal after Honesty — not a quiz, not fashion chat, not Studying Scan.  
> **Date of capture:** 2026-09-02.  
> **Source of truth:** code. If this document and code disagree, **code wins**.  
> **UI entry:** `OnboardingGate` when `step === "verdict"` and `finale === "card"`.  
> **Component:** `src/components/onboarding/fitting/FittingVerdictStep.tsx`.

Related docs (do not substitute this file for them):

| File | Owns |
|------|------|
| [`questions-for-agents.md`](./questions-for-agents.md) | What the wizard **asks** |
| [`onboarding-flow.md`](./onboarding-flow.md) | Storage + fashion-memory seed |
| [`../fashion/memory-extraction-and-people.md`](../fashion/memory-extraction-and-people.md) §11 | What of this is **not** a chat pref |
| [`../fashion/search-pipeline-agent.md`](../fashion/search-pipeline-agent.md) | Chat search (different product) |

---

## 0. How to use this document

Read in order: **§1 identity → §2 sequence → §3 jobs → §4 gates → §5 LLM payloads → §6 UI field map → §7 skip/fail**.

**Agent contract:**

1. Attribute a missing or wrong card field to **exactly one job** (§3). Do not add a prompt line when the mapper never reads that JSON path.
2. The live stylist-verdict LLM uses `STYLIST_READING_SCHEMA`, **not** the full `STYLIST_VERDICT_SCHEMA`. Roots the reading schema omits are hydrated as `{}` / `[]` and are empty at display time.
3. Catalog products on this page are **illustrative**. They are not fashion-memory signals, not chat finds, and not wired to planner/scoring.
4. Do not import `src/lib/photo-analysis/run.ts` from fashion-memory, hard-drops, scoring, or curation.
5. Do not confuse this page with **Studying Scan** (`runLookScanVerdict`) — that judges a dressed look later, after try-on.

---

## 1. What this page is

**Is:** a client render of (a) a stored `StylistVerdict` JSON mapped by `buildReadingView`, (b) quiz-derived style mix, (c) Shopify catalog stills pulled from verdict formulas, (d) FASHN try-ons of those stills onto the already-minted twin.

**Is not:**

- A fashion-chat search (`POST /api/chat`).
- Studying Scan / look-scan (`src/lib/tryon/look-scan-verdict.ts`).
- The scan-check screen (`FittingAnalysisPanel` / `finale: "scan"`). That is the **gate** that must finish before this card.
- A second photo-analysis call. The card does not re-send the selfie to OpenAI.

Two finales share `step: "verdict"`:

| `finale` | Component | When |
|----------|-----------|------|
| `scan` | `FittingAnalysisPanel` | Photo exists, biometric consent on, verdict not yet `done` |
| `card` | `FittingVerdictStep` | Verdict saved, photo skipped, or biometric off |

`verdictUiFinale` / `pinVerdictFinale` in `src/lib/photo-analysis/scan-phase.ts`. Once `finale === "card"`, analysis polling must not yank the user back to scan.

---

## 2. End-to-end sequence

Jobs 1–3 can start as soon as the photo is accepted (often during `photo` / `fit`). Job 4 waits for Honesty lock-in + scan confirm. Jobs 5–6 run only after the card mounts with a stored verdict. Twin mint (job T) is parallel from fit-save and is required for dressed photos, not for copy.

```
PHOTO UPLOAD (step photo, coverage locked to "face")
  POST /api/onboarding/photo-analysis          [multipart, after()]
    J1  Luna preflight          vision JSON     PhotoAnalysis.gate
    J2  Terra analysis          vision JSON     PhotoAnalysis.result
  POST /api/avatar/upload + mint               [parallel, FASHN]
    JT  Twin body               image           AvatarDraft / twin URL

QUIZ (name → life → spend → worn → corner → nolist → honesty)
  PATCH profile / sizing / brands / tags       [no LLM for mix]
    JD  computeStyleMix         code            UserProfile.styleMix

HONESTY "Lock it in" → step verdict, finale scan
  PATCH /api/onboarding/photo-analysis         [user review]
    J3  Scan-check save         no LLM          PhotoAnalysis.userReview
  POST /api/onboarding/stylist-verdict         [after()]
    J4  Sol reading verdict     text JSON       PhotoAnalysis.verdict

finale card  →  FittingVerdictStep mounts
  GET  /api/onboarding/reading-looks
    J5  Catalog search          Shopify MCP     ephemeral { items }
  POST /api/tryon/fitting-room  (per look / swatch)
    J6  Dress on twin           FASHN           job poll → image URL
```

**Nothing on the card is a live LLM call.** J4 already finished. The card is a mapper + search + try-on.

---

## 3. Job inventory

| ID | Name | Trigger | Model / engine | Timeout | Persist |
|----|------|---------|----------------|---------|---------|
| J1 | Photo preflight | `kickPhotoAnalysis` after selfie | `gpt-5.6-luna` (`OPENAI_PHOTO_ANALYSIS` no; `OPENAI_PHOTO_PREFLIGHT_MODEL`) | 25s | `PhotoAnalysis.gate` |
| J2 | Photo analysis | J1 `next_action` = `run_full_analysis` | `gpt-5.6-terra` (`OPENAI_PHOTO_ANALYSIS_MODEL`) | 170s | `PhotoAnalysis.result` |
| J3 | Scan-check | CTA `That’s me` | none | — | `PhotoAnalysis.userReview` |
| J4 | Stylist verdict | `kickVerdict` after J3 (or poll sees review) | `gpt-5.6-sol` (`OPENAI_STYLIST_VERDICT_MODEL`) | 90s | `PhotoAnalysis.verdict` |
| J5 | Reading looks | card `useEffect` when `verdict` truthy | Shopify catalog MCP | 8s/query | **none** (response body only) |
| J6 | Dress look | card when `twinReady` and J5 products exist | FASHN fitting-room | poll ≤ 360s | try-on job rows; UI holds URLs in React state |
| JT | Twin mint | fit save with photo (height optional; silhouette default 170cm for mint only) | FASHN avatar | mint pipeline | avatar image |
| JD | Style mix | taste persist (worn / corner / nolist) | none (`computeStyleMix`) | — | `UserProfile.styleMix` |

Engine version on the analysis row: `style-photo-v4` (`PHOTO_ANALYSIS_ENGINE_VERSION`).

OpenAI transport for J1/J2/J4: `callPhotoJsonSchema` → `POST https://api.openai.com/v1/responses`, `text.format.type = json_schema`, `strict: true`, `store: false`. Serialized with `withPhotoGptLock` (one photo GPT call at a time per process).

---

## 4. Gates (what must be true before J4)

Server: `assembleVerdictInput` → `verdictReadiness` (`src/lib/photo-analysis/verdict-input.ts`).

| Check | Source | Fail |
|-------|--------|------|
| Usable photo analysis | `result.analysis_status.usable === true` | 409 `photo_analysis` |
| Review submitted | `userReview` parses | 409 `user_review` |
| Gender presentation | `UserProfile.genderPresentation` | 409 `gender_presentation` |

Client `kickVerdict` (`FittingAnalysisPanel`) also:

1. Persists scan-check body (`onPersistBody` → sizing PATCH).
2. POSTs `{ hash, declared_body }` to `/api/onboarding/stylist-verdict`.
3. Idempotent: if `verdictStatus === "running"` or already `done` with JSON, returns stored row (no second LLM).

Skip paths that **never run J4** still open the card:

- No photo, or biometric declined → `finale: "card"` immediately.
- Scan-check `Skip for now` / unusable photo `Skip for now` → card with `verdict = null`.
- J4 error + `Continue without it` → card with `verdict = null`.

A null verdict still shows: name headline, mix donut (quiz), veto count, footer. It does **not** show five looks, areas, palette, or “the difference” steps.

---

## 5. Jobs in detail — inputs and outputs

### J1 — Photo preflight

**Files:** `src/lib/photo-analysis/analyze.ts` `preflightStylePhotos`; prompt `src/lib/photo-analysis/prompt.ts` `STYLE_PHOTO_PREFLIGHT_*`.

**Images:** one JPEG data URL, `detail: "low"` (`jpegDataUrlLow`).

**Text payload:**

```
{ target_person, requested_coverage, allow_partial_analysis }
```

Onboarding always:

- `target_person` = `"the only person in all images"` (`DEFAULT_TARGET_PERSON`)
- `requested_coverage` = `"face"` (locked in `OnboardingGate`)
- `allow_partial_analysis` = `false` (`runPhotoAnalysis`)

**Output:** `StylePhotoPreflight`. Onboarding only continues to J2 when `shouldRunDetailedAnalysis(gate, false)` — i.e. `next_action === "run_full_analysis"`. `rescueClearFaceGate` can salvage a studio headshot Luna tagged as screenshot/generated if a single clear face is visible.

J1 is **not** shown on the card. It only decides whether J2 runs. Failed gate → scan UI “Couldn’t read it” / skip.

---

### J2 — Photo analysis (Terra)

**Files:** `analyzeStylePhotos`; prompt `STYLE_PHOTO_ANALYSIS_*`.

**Images:** original JPEG data URL, `detail: "original"`.

**Text payload:**

```
{
  task: "Create the photo-derived portion of this person's professional style profile.",
  target_person,
  requested_coverage: "face",
  declared_context: { ... },   // from FormData declared_context
  instruction: "Use declared_context as user-supplied facts. Do not claim those facts were visually verified. ..."
}
```

**`declared_context` at upload time** (`buildDeclaredStyleContext` in `OnboardingGate`) — often sparse because the photo is taken **before** most quiz steps:

| Key | When present |
|-----|----------------|
| `gender_presentation` | identity already filled |
| `age` | DOB not skipped |
| `location` | identity persisted + shipping country |
| `height_cm` | sizing persisted |
| `weight_kg` | weight entered |
| `torso_to_leg` | `legLine` set |
| `requested_coverage` | always `"face"` |
| `week_is` / `weekends_are` / `climate` | life step already filled (Tell-me or resume) |

This is **not** the verdict questionnaire. J4 rebuilds the full profile from Prisma later.

**Output stored:** `StylePhotoAnalysis` (`result.ts`). Card never renders this JSON directly. J4 receives the whole object as `photo_analysis`. Scan-check (J3) reads only these assessment paths:

| UI label | JSON path |
|----------|-----------|
| Skin tone | `visible_profile.color.visible_skin_surface_tone` (fallback `skin_depth`) |
| Undertone | `visible_profile.color.undertone_hypothesis` |
| Contrast | `visible_profile.color.facial_contrast` |
| Eyes | `visible_profile.color.eye_color` |
| Hair | `visible_profile.color.hair_color` |
| Face | `visible_profile.face.primary_shape` |
| Hair length | `visible_profile.hair_and_grooming.hair_length` |
| Facial hair | `visible_profile.hair_and_grooming.facial_hair_style` |

`listConfirmableTraits` — a row appears only if `value` is a non-empty string. Empty set → “Not enough from the photo.”

**Do not seed** any of this into fashion-memory. Isolated store.

---

### J3 — Scan-check (user review)

**Client:** `FittingAnalysisReview.save` → `PATCH /api/onboarding/photo-analysis` `{ hash, review }`.

**Body:** `buildStyleUserReview`:

```
{
  confirmed_paths: string[],          // paths left unchanged
  corrections: [{ path, previous_value, corrected_value }],
  rejected_paths: [],                 // live UI does not reject; empty
  notes: [],
  submitted_at: ISO,
  confirmed_body: {
    height_cm, weight_kg, body_type,
    muscularity, body_shape, bust_fullness, leg_line
  }
}
```

`confirmed_body` is the **fit-step answers** (plus any scan-check edits), not Terra’s proportion guesses. J4 authority order: user corrections > confirmed_body > questionnaire > remaining visual.

---

### J4 — Stylist verdict (the JSON the card is built from)

**Route:** `POST /api/onboarding/stylist-verdict` `{ hash, declared_body? }` → `after(generateStylistVerdict)`.

**Assembler:** `assembleVerdictInput(userId, photoHash)` loads in parallel:

| Prisma | Maps into payload key |
|--------|------------------------|
| `PhotoAnalysis.result` | `photo_analysis` |
| `PhotoAnalysis.userReview` | `user_review` |
| `UserProfile` | `questionnaire_answers` + `application_context` (`weekendsAre` → `lifestyle.weekends_are`) |
| `SizingProfile` | `measurements.body` / `preferred_fit` / `sensitivities` |
| `BrandPreference[]` | `brands_like` / `brands_avoid` **and** `brands[].reasons` |
| `HardNegative[]` | `style_vetoes` / `comfort` as `{ value, note, reason }` (note `comfort` or scope `fit` → comfort) |
| `TasteTag[]` | `worn` / `wanted` / compliment + comfort tags |

`declared_body` on the POST **overrides** `measurements.body` height/weight/build/shape fields if present.

**User content (single `input_text`):** JSON of:

```
{
  task: "Generate the canonical personal-stylist verdict from this reviewed profile.",
  data_manifest: {
    present_domains: string[],   // listPresentDomains()
    instruction: "Every domain in present_domains must change the verdict. Cite each in based_on."
  },
  photo_analysis,
  user_review,
  questionnaire_answers,
  measurements,
  wardrobe_inventory,
  application_context
}
```

#### `questionnaire_answers` (from `buildVerdictPayload`)

```
identity: { gender_presentation, age_years, age_range, style_era, style_era_label }
goal / goal_label                         // dressingFor
lifestyle: { week_is, week_is_label, weekends_are, weekends_are_label, kids, kids_label, occupation, work_environment, lifestyle_tags }
climate / climate_label
location: { city, country }               // often empty on live wizard
budget: { currency, philosophy, philosophy_label }
taste: {
  style_era, style_era_label,
  honesty, honesty_label,                 // "1"–"5"
  honest_corner: { friction, become },
  compliments,                            // profile chips + compliment tags
  style_mix                               // UserProfile.styleMix
}
```

Empty strings / empty arrays / empty objects are stripped (`compact`).

#### `measurements`

```
body: {
  height_cm, weight_kg, body_type,        // confirmed_body wins over SizingProfile
  muscularity, body_shape, bust_fullness, leg_line,
  shoulder_width, neck, sleeve,           // sizing columns; usually unset
  top_usual_size, bottom_waist, bottom_inseam, bottom_rise,
  shoe_eu, shoe_width
}
preferred_fit: { top, bottom }
sensitivities: string[]                   // comfort lines
known_good_garments: []                   // always empty here
confirmation_source: "user_scan_review" | "sizing_profile"
```

#### `wardrobe_inventory`

```
worn: string[]                            // TasteTag category worn
wanted: string[]                          // category aspirational (legacy)
honest_corner: { friction, become }
brands_like / brands_avoid                // names only
brands: [{ brand, sentiment, reasons }]   // BrandPreference.reasons kept
style_vetoes / comfort: [{ value, note, reason }]
style_mix
```

#### `application_context`

```
market, city, preferred_size_systems, honesty
```

#### `present_domains` checklist

Possible tokens: `identity`, `lifestyle`, `climate`, `budget`, `taste`, `body`, `wardrobe`, `comfort`, `vetoes`, `face_scan`. Each listed domain must change the verdict (prompt rule). Missing domains are omitted, not sent as null.

#### Call knobs

| Knob | Live value |
|------|------------|
| Instructions | `STYLIST_VERDICT_INSTRUCTIONS` + `STYLIST_READING_INSTRUCTIONS` |
| Schema | **`STYLIST_READING_SCHEMA`** (not full catalog schema) |
| Schema name | `canonical_personal_stylist_verdict` |
| Reasoning | `{ effort: "low" }` — do not raise to medium until `VERDICT_TIMEOUT_MS` has been tried |
| Max tokens | 16_000 |
| Hang-safety | `VERDICT_TIMEOUT_MS` = 90s |
| Safety | SHA-256 of `userId` |
| Persist | `verdict` + `verdictMs` + `verdictModel` + `verdictTokens` (OpenAI `usage`) |

#### What the LLM is asked to emit (reading roots)

`STYLIST_READING_ROOT_KEYS`:

```
verdict_status
executive_verdict
style_identity
color_system          // COLOR_READING_KEYS only (no whites/denim/leather/metals/combinations)
proportion_and_silhouette
size_and_fit
fabrics_patterns_and_climate
outfit_formulas       // prompt: exactly 5 named looks
user_facing_verdict
```

Prompt caps: other arrays ≤ 4, colour lists ≤ 4, short strings. `outfit_formulas`: occasion = look name; `formula` + `footwear` = garments to pull.

#### What is NOT generated on this call

These exist on `STYLIST_VERDICT_SCHEMA` and on the TypeScript type, but **are not in the reading schema**. `hydrateStylistVerdict` fills missing roots so `parseStylistVerdict` succeeds:

| Root | Hydrated as | Card consequence |
|------|-------------|------------------|
| `garment_playbook` | `[]` | `buyQueries` playbook branch empty |
| `wardrobe_plan` | `{}` | `buyQueries` priorities/actions empty |
| `shopping_engine_profile` | `{}` | unused on card |
| `grooming_and_accessories` | `{}` | unused on card |

**Do not tell an agent “shopping_engine_profile drives the looks.”** Looks come from `outfit_formulas`. Buys/“First to get” / step product tiles need `wardrobe_plan` / core playbook, which this call does not produce — those UI slots stay empty unless a stored full-schema verdict (legacy) exists.

#### Persist

`saveVerdict(rowId, verdict, ms, model, tokens)` → `verdictStatus: "done"`, `verdictTokens` = OpenAI usage JSON. Failure → `verdictError` string, status `done`, tokens nulled. Stale `running` older than `VERDICT_STALE_MS` (110s) is expired.

---

### JD — Style mix (donut)

**Not an LLM.** `computeStyleMix` in `src/lib/onboarding/style-mix.ts`, called from `taste-persist.ts` when worn / Honest Corner / nolist save.

Votes (top 3 axes, percents sum to 100):

| Input | Weight |
|-------|--------|
| Worn pick `archetype` | ×3 |
| Aspirational pick `archetype` | ×2 |
| `styleBecome` keyword hits | ×2 |
| `styleFriction` keyword hits | ×1 |
| Worn/aspirational **labels** | only if no archetype votes |
| Compliment chips / extra taste tags | ×1.5 / ×1 |
| Nothing matched | Minimal 3, Classic 2, Parisian 1 |

Axes: Parisian, Minimal, Romantic, Street, Classic, Sporty, Boho, Bold.

Card mapper `readingMix`: uses `styleMix.axes` if present; else fallback from `wornLabels[0]`, `stealLabels[0]` (`styleBecome` or aspirational labels), `leanLabel` (first mix axis). Colors are hardcoded `MIX_COLORS`. Details from `MIX_DETAIL`.

---

### J5 — Reading looks (catalog)

**Route:** `GET /api/onboarding/reading-looks` (optional `?hash=`). Latest analysis if hash omitted.

**Code:** `readingLookQueries` → `runReadingLooks`.

Query budget: `LOOK_COUNT=5` looks × `PIECES_PER_LOOK=4` = 20 formula queries, **then** leftover room for buy queries, **then** swatch/avoid queries (not counted against `MAX_QUERIES`).

| Kind | Built from | Query shape |
|------|------------|-------------|
| `look` | `outfit_formulas[0..4]` | `{color_options[0]} {piece}` per formula[0..2] + footwear[0] |
| `buy` | `wardrobe_plan` / core `garment_playbook` | usually **none** on live reading schema |
| `swatch` | `readingPalette` near/core/neutrals/accents, max 6 | `{colorName} {crew neck\|use}` |
| `avoid` | `color_system.use_carefully`, max 2 | same garment helper |

Search:

- Token: Shopify catalog MCP (`accessTokenForCatalogMcp`, `resolveSearchCatalog`).
- Limit 8 hits / query; 8s abort each.
- Filters: `available: true`; `ships_to.country` if `UserProfile.shippingCountry` is ISO2; `Target gender` from `genderFromUserProfile(genderPresentation)` (`mens` / `womens`; mixed → no gender filter).
- Query prefix: `ensureDepartmentQueryPrefix` unless department is `mixed`/null.
- Context intent: `"Onboarding reading — illustrate the stylist verdict"`.
- Pick: first hit with id + image + title, unique product id globally, unique title-key per look (`productTitleKey` strips colourway suffixes).

Response `{ items: ReadingLookItem[] }` is **not stored**.

---

### J6 — Dress on you (FASHN)

**Client only**, `FittingVerdictStep.dressLookOnYou`.

For each of: up to 5 look groups + each swatch + each avoid that has a product:

1. `POST /api/tryon/fitting-room` `{ items: [{ provenance: { kind: "product", productId } }] }` (max 6 garments).
2. Poll `GET /api/tryon/fitting-room/:jobId` every 1.5s up to `TRYON_CLIENT_POLL_MAX_MS` (default 360s).
3. If product provenance fails, retry with `{ kind: "image", imageUrl, title, garment, styleId }`.

Requires `twinReady` (`twinStatus === "ready"` && twin URL). No twin → rail shows “Waiting for your twin…”. Failed job → “Couldn’t dress this one.” + one Retry.

Images live in component state (`lookOnYou`). Not written to `PhotoAnalysis`.

Each dress attempt fires `twin_render_completed` / `twin_render_failed` with `{ source: "reading_look", ms }` so the pilot measures this rail, not the fitting-room proxy.

---

### JT — Twin (prerequisite for J6)

Started at fit-save: attach selfie `POST /api/avatar/upload`, then background mint with height/build/muscularity/shape/bust. Independent of J4. Card copy does not wait for it; dressed photos do.

---

## 6. UI field map

Mapper: `buildReadingView` (`src/lib/photo-analysis/verdict-reading.ts`). Pure. Props from `OnboardingGate` + stored verdict + J5 items.

### 6.1 Always-on chrome (even with `verdict = null`)

| UI | Source | Job |
|----|--------|-----|
| Kick `DONE` | literal | — |
| `{FirstName}, here's what I see.` | `preferredName` (title-cased first token) | quiz `name` |
| Opening paragraph | `user_facing_verdict.opening` else `executive_verdict.profile_summary` else build+form fallback copy | J4 or JD/fit |
| Bold headline sentence | `executive_verdict.headline` else `user_facing_verdict.title` | J4 |
| `from:` (behind the fold) | `style_identity.based_on` via `reading.from` | J4 |
| `Your N hard vetoes stay locked` | `hardAvoids.length + brandAvoids.length + comfort.length` | quiz `nolist` |
| Whisper `{n}% developed` | `developPctFromFlags` (quiz flags + twin + dress) | code |
| Footer `That's you. Now the clothes.` | literal | — |
| CTA | Save looks / finish The Fitting | — |
| Share clipboard | `user_facing_verdict.title + opening` else worn/become/veto prose | J4 or quiz |

Fallback opening when no verdict: `"{Build copy}. {Form tip}."` from `BUILD_TXT[build]` + form `f`/`m`/else.

### 6.2 FIVE LOOKS ON YOU (`LooksOnYouRail`)

Shown when J5 returns `kind: "look"` items (needs J4 `outfit_formulas`).

| UI | Source |
|----|--------|
| Label | `outfit_formulas[i].occasion` (else `.name` else `Look {i+1}`) via `item.lookLabel` |
| Image | J6 try-on URL for `lookId` `look-{i}` |
| Placeholder copy | pulling / waiting twin / dressing / error |

Optional extra group of buy products (`kind: "buy"`) is built only when `wardrobePlanHasBuys` — `wardrobe_plan.shopping_priorities` or add-`actions` have content (legacy full-schema rows). New reading-schema verdicts hydrate `wardrobe_plan: {}` and render nothing. When present, the fold shows **First to get**; `productForStep` on Difference cards uses the same gate.

### 6.3 THE DIFFERENCE (`reading.steps`, shown if `length >= 2`)

| UI | Source | Fallback |
|----|--------|----------|
| Card title (`name`) | first sentence of `user_facing_verdict.first_five_actions[i]`, i∈0..2 | `outfit_formulas[i].occasion` |
| Body (`why`) | full action string | `silhouette_notes` or `formula.join(" · ")` |
| Labels | `ONE CHANGE` / `AND A TUCK` / `IF YOU PUSH` | — |
| Product still | `productForStep(why, looks)` — first **buy** item whose query token (>3 chars) appears in `why` | usually **none** (no buy queries) |
| H2 count | `max(fix-areas, steps.length, 3)` | — |

### 6.4 WHAT YOU CAN AND CANNOT (`reading.areas`)

Built only if `verdict` is non-null. Order fixed. An area is dropped if insight and both rec lists are empty.

| Area id | Title | JSON | Sum | Metrics | Do (✓) | Don’t (✕) | FIX vs WORKS |
|---------|-------|------|-----|---------|--------|-----------|----------------|
| `colour` | Your colouring | `color_system` | seasonal · undertone · depth | Undertone=`temperature`, Depth, Contrast, Near the face=`near_face_colors[0].name` | first 2 near-face names + `color_shopping_rules` | `use_carefully` `color_or_family — issue` | FIX if dont>do and do empty |
| `proportion` | Your proportions | `proportion_and_silhouette` | first sentence of `strategy_summary` | Silhouette[0], Structure, Length[0], Priority[0] | silhouette/length/volume arrays | `test_in_fitting` | dont>do |
| `fit` | Size and fit | `size_and_fit` | protocol / starting size basis / warning | up to 3 `starting_sizes` (else known_good, else confidence/alter/risk) | protocol + alterations | `measurements_still_needed` + `recurring_fit_risks` | FIX if sizes needed and no starting sizes |
| `fabric` | Fabric and how it hangs | `fabrics_patterns_and_climate` | `climate_strategy` | Best fabric, Careful, Layer | `best_fabrics` + `useful_blends` | `fabrics_to_use_carefully` | dont>do |
| `identity` | Your taste | `style_identity` | primary · secondary | Primary, Second, Signature | signature_elements + descriptors | `aesthetic_boundaries` | dont>do |
| `rules` | Rules I'll hold you to | `user_facing_verdict` | first rule/mistake | Rule 1..3 = golden_rules | `golden_rules` | `mistakes_to_avoid` | FIX if mistakes > rules |

Thumb colour: colour area uses first near-face hex; others hardcoded. Open-by-default: first area with `verdict === "n"`, else first area.

### 6.5 FROM YOUR OWN SKIN, HAIR AND EYES

`readingPalette(verdict)`:

**Suit you (max 6):** concat `near_face_colors`, `core_colors`, `best_neutrals`, `accent_colors` — unique by name. Hex from `representative_hex` (normalized); missing → `#B8894F`.

**Never next to your face (max 2):** `use_carefully`. Hex **hardcoded `#14141A`** (not from the model). Overlay strike on the swatch.

Each swatch/avoid with a J5 product is dressed (J6) into `lookOnYou["swatch-{i}"]` / `["avoid-{i}"]`. Until then: CSS radial gradient using the hex. `use` / `name` are **not** rendered as captions on the swatch grid.

### 6.6 THE TASTE YOU PICKED (donut)

`reading.mix` from JD. Shown if any axis `percent > 0`. Independent of J4.

### 6.7 Props passed but not rendered

`dressStatus`, `dressStyleLabel`, `dressedLookUrl` are still passed from `OnboardingGate` into `FittingVerdictStep`. The current card does not paint them. Do not treat them as card data.

---

## 7. Skip, empty, and failure matrix

| Situation | Card shows |
|-----------|------------|
| No photo / biometric off | Mix + fallback opening. No looks, areas, palette, steps. |
| Scan skipped | Same as null verdict. |
| J1 reject / J2 unusable + skip | Same. |
| J4 409 missing fields | Stays on scan “Writing…” error; retry or skip. |
| J4 timeout / non-JSON | `verdictError`; retry or skip to empty card. |
| J4 ok, `outfit_formulas` empty | No five-looks rail content (placeholders only while `looks === null`). |
| J4 ok, no `color_system` colours | No palette section. |
| J5 401 / empty items | Looks rail errors / “Pulling…” then empty groups. Copy still shows. |
| Twin not ready | Looks stay on “Waiting for your twin…”. |
| J6 fail | Per-slot error + one retry. |

`developPct` is **not** “verdict quality”. It is a quiz-progress heuristic (4–100) from persisted flags.

---

## 8. What this pipeline does not do

- Does **not** run fashion router / planner / hard-drops / curator.
- Does **not** write `shopping_engine_profile` on the live call.
- Does **not** seed face-scan traits or verdict JSON into Store A (`fashion_facts`).
- Does **not** use clothing sizes from the wizard (those columns are unused here).
- Does **not** re-analyze the photo at verdict time.
- Does **not** block onboarding complete on J4 (skip is allowed). Server complete still only requires name + presentation + ageRange.

---

## 9. Code index

| Path | Role |
|------|------|
| `src/components/onboarding/OnboardingGate.tsx` | Orchestrates steps, `kickPhotoAnalysis`, twin mint, passes card props |
| `src/components/onboarding/fitting/FittingAnalysisPanel.tsx` | Scan UI + `kickVerdict` |
| `src/components/onboarding/fitting/FittingAnalysisReview.tsx` | J3 confirm/correct |
| `src/components/onboarding/fitting/FittingVerdictStep.tsx` | Card UI, J5 fetch, J6 dress |
| `src/lib/photo-analysis/scan-phase.ts` | `reading` / `review` / `writing` / `done` |
| `src/lib/photo-analysis/run.ts` | J1+J2 runner |
| `src/lib/photo-analysis/analyze.ts` | Models, timeouts, OpenAI calls |
| `src/lib/photo-analysis/prompt.ts` | J1/J2 prompts + schemas |
| `src/lib/photo-analysis/review.ts` | Trait list + review types |
| `src/lib/photo-analysis/verdict-input.ts` | Prisma → J4 payload |
| `src/lib/photo-analysis/verdict.ts` | `generateStylistVerdict`, parse/hydrate |
| `src/lib/photo-analysis/verdict-prompt.ts` | J4 instructions + reading schema |
| `src/lib/photo-analysis/verdict-reading.ts` | JSON → card view |
| `src/lib/photo-analysis/reading-looks.ts` | JSON → catalog queries |
| `src/lib/photo-analysis/run-reading-looks.ts` | J5 I/O |
| `src/lib/onboarding/style-mix.ts` | JD |
| `src/app/api/onboarding/photo-analysis/route.ts` | POST J1/J2, PATCH J3, GET poll |
| `src/app/api/onboarding/stylist-verdict/route.ts` | POST J4 |
| `src/app/api/onboarding/reading-looks/route.ts` | GET J5 |
| `src/app/api/tryon/fitting-room/route.ts` | POST J6 |
| `src/lib/photo-analysis/eval/` | P4 card-text fixtures + Prisma-seed `--generate` similarity |
| `prisma/schema.prisma` `PhotoAnalysis` | Persistence (`verdictTokens`) |

Tests that encode this contract: `verdict-reading.test.ts`, `verdict-input.test.ts`, `reading-looks.test.ts`, `review.test.ts`, `eval/verdict-eval.test.ts`.
