# Fashion memory, extraction, preferences, and people

> **Audience:** an AI agent reading this to simulate, debug, extend, or not-break Shoop memory.  
> **Code wins.** If this file and code disagree, follow the code.  
> **Date:** 2026-08-27.

**Live shopping reads fashion-memory, not Prisma profile tables.**  
Search / hard-drops / curation never query `UserProfile`, `TasteTag`, or `Recipient` at request time. Those Prisma tables are **onboarding + extra-notes storage**. They reach the shopper only after a **projection** onto the self person in fashion-memory.

---

## 0. How to use this document

1. Attribute a memory bug to **exactly one store and one write path** (tables in §1–§3). Do not add a second extractor when the first one already owns the fact.
2. **Person isolation is absolute.** A fact or signal always belongs to one `person_id`. The shopper’s sizes/taste never copy onto a gift recipient. A recipient’s sizes/taste never copy onto the shopper.
3. Chat extraction records **claims about people**, not item specs for this purchase. Requests are logged as `request_events`. Those never become active taste until corroboration.
4. Moodboard saves, Ask votes, **face-scan JSON, and stylist/look-scan verdicts** do not write fashion-memory. Checkout success writes a `purchase` request_event on the originating search’s recipient plus stated 0.9 attribute signals (`writePurchaseMemory`). Do not invent a “scan saw warm undertone → color signal” or “verdict golden rule → no_go” path.
5. Guests never hit Postgres fashion tables. Same shapes live in `FashionLocalStore` (localStorage) and migrate on sign-in.

**Related docs (narrower):**

| File | Owns |
|------|------|
| [`extraction.md`](./extraction.md) | Verbatim extraction **prompt** only |
| [`before-ready-to-search.md`](./before-ready-to-search.md) | How ROSTER/PROFILES are **read** pre-search |
| [`../onboarding/onboarding-flow.md`](../onboarding/onboarding-flow.md) | Wizard fields → Prisma |
| [`../onboarding/questions-for-agents.md`](../onboarding/questions-for-agents.md) | Live wizard question script (copy + enums) |

**Field-by-field onboarding / scan / verdict → prefs:** §11.

---

## 1. Two stores — do not conflate them

### Store A — fashion-memory (live for chat)

Supabase tables, Prisma models `FashionPerson` / `FashionFact` / `FashionStyleSignal` / `FashionRequestEvent` / `FashionExtractionRun`.

| Table | Shape | Job |
|-------|--------|-----|
| `people` | `id`, `user_id`, `relation`, `name`, `birthday`, `notes`, `intake_completed_at`, avatar | Roster: **self** + everyone they shop for |
| `fashion_facts` | per person; `fact_type` + optional `garment_type`; jsonb `value`; `status` active/superseded | Hard knowledge: size, fit, no-go, budget, department, body note, measurement, depth_default |
| `style_signals` | per person; `context`, `signal_type`, `value`, `polarity` ±1, `source`, `confidence`, `status` | Soft taste. Decays. Ranked into router PROFILES |
| `request_events` | per person; jsonb `attributes`; optional `conversation_id` | Episodic “what they asked for this turn”. **Never** a signal by itself |
| `extraction_runs` | per user + conversation; watermark `last_message_id` | Dedup / lock for the async clerk |
| `interaction_signal_dedup` | `(search_id, interaction, ref)` | Idempotent rail-interaction writes |

**Code:** `src/lib/fashion-memory/people.ts`, `facts.ts`, `signals.ts`, `types.ts`.  
**Guest mirror:** `src/lib/fashion-memory/local/store.ts` (`GuestFashionMemorySnapshot`).

### Store B — Prisma typed profile (onboarding / extra notes)

Written by the wizard and by `projectExtractionToTypedTables`. **Not** read by the fashion router except:

- `loadIntakeProfileHints` — self department + sizes + preferred name, **self only**.
- `seedOnboardingIntoFashionMemory` — copies a snapshot of B onto Store A **self**.

| Table | Job |
|-------|-----|
| `UserProfile` | Identity, spend philosophy, honesty, lifestyle, style mix, onboarding flags |
| `SizingProfile` | Top / bottom / shoe for the **buyer** |
| `BrandPreference` | Brand love/avoid |
| `HardNegative` | Never-recommend rules |
| `TasteTag` | Worn / steal / compliment / other taste tags |
| `OwnedProduct` | Things they said they own (extra-notes LLM only on live path) |
| `Recipient` | Gift-recipient blob from extra-notes LLM — **not** the fashion roster |
| `ShoppingIntent` | Session wishlist from extra-notes LLM |
| `CategoryPreference` | Per-category likes from extra-notes LLM |
| `PhotoAnalysis` | Face-scan gate + vision JSON + user review + **stylist verdict**. Isolated (`run.ts`: do not import from fashion-memory). Display + verdict LLM only |

**Critical gap:** `Recipient` (Store B) is **not** projected into `people` (Store A). Fashion chat people come from `people` only: self seed, trusted circle, mention-ensure, extraction `new_person`, intake `stated_facts`.

**Second gap:** height / weight / build **are** written to `SizingProfile`, but seed **does not** copy them into `fashion_facts`. Chat scoring must not treat them as size facts. They drive the **twin** and the **stylist-verdict LLM**, not the catalog gate.

---

## 2. What a “preference” is

There is no single Preferences object. Downstream sees **facts** (hard) and **signals** (soft), always keyed by person.

### Facts (`fashion_facts`)

Never decay. Same `(person_id, fact_type, garment_type)` **supersedes** the previous active row (never hard-delete). Latest write wins.

| `fact_type` | `garment_type` | Value |
|-------------|----------------|-------|
| `size` | `tops` / `bottoms` / `shoes` / `dresses` | `{ system, value, brand_exception? }` |
| `fit` | garment family | `{ fit: slim\|regular\|relaxed\|oversized }` |
| `no_go` | slug like `nogo-material-leather` | `{ kind: material\|style\|color\|garment, value }` |
| `budget_band` | optional | `{ min, max, currency }` |
| `gender_presentation` | null | `{ presentation: mens\|womens\|boys\|girls\|baby\|mixed }` |
| `body_note` | often `onboarding-meta` | free jsonb (age, lifestyle, honesty, style mix, …) |
| `measurement` | **must equal the metric** | `{ metric, value, unit }` — reserved; scoring must not consume |
| `depth_default` | null | `{ count, unit: looks\|options }` |

### Signals (`style_signals`)

Decay with a **9-month half-life** from `last_seen_at`. Router/extractor hide signals whose **effective** confidence `< 0.15`.

| Field | Meaning |
|-------|---------|
| `signal_type` | `color`, `style`, `brand`, `silhouette`, `aesthetic`, `material`, `pattern`, `garment`, `shopping_style` |
| `value` | normalized lowercase string |
| `polarity` | `+1` like, `-1` dislike |
| `context` | `general`, `everyday` (worn grid), `elevated` (steal grid), or occasion labels (`work`, `gym`, …) |
| `source` | rank: `stated` (4) > `rejection` (3) > `inferred` (2) > `request` (1). Stated **never** overwritten by inferred |
| `status` | `stated` → `active`. Inferred often lands `candidate` until promoted. `superseded` is dead |
| `confidence` | capped at 0.95; evidence_count increments on re-see |

`shopping_style` values: `quick` | `guided`.

---

## 3. Write paths (inventory)

Every inbound preference is one of these. If it is not in this list, it is not written.

### 3.1 Onboarding wizard → Store B → seed self (Store A)

**When:** complete + background `OnboardingProjectionJob`; also first fashion turn if projection job not yet `completed` (inline seed, 1.5s cap then continue in background).

**Owner:** `src/lib/onboarding/seed-fashion-memory.ts` ← snapshot from `projection-snapshot.ts`.

Seeds **self person only**:

| Onboarding | Fashion-memory |
|------------|----------------|
| `preferredName` | `people.name` on self |
| `genderPresentation` | `gender_presentation` fact |
| sizing top/bottom/shoe | `size` facts per bucket |
| age, lifestyle, week, kids, climate, honesty, compliments, style mix, value philosophy | one `body_note` `garment_type=onboarding-meta` |
| `HardNegative` | `no_go` facts (classified material/color/garment/style) |
| `BrandPreference` | `brand` signals, polarity −1 if avoid/hate, source `stated`, confidence 0.85 |
| `TasteTag` in fashion categories | signals; `worn` → context `everyday`, `aspirational` → `elevated` |
| `valuePhilosophy` | inferred `aesthetic` (quiet luxury / quality first / value conscious / design led), confidence 0.55 — **never** a numeric `budget_band` |

Taste categories **dropped** at seed: home / tech / lifestyle noise. Kept: `fashion`, `outfit`, `style`, `personality`, `worn`, `aspirational`, `compliment`.

**Worn vs steal grids:** max 3 worn, max 2 steal. Tags from card label + tasteTags + title tokens → `TasteTag` then seed as above. This is the closest thing to “looks I actually wear / would steal.” It is **not** a wardrobe inventory.

**Trusted circle:** `POST /api/onboarding/circle` → `saveTrustedCirclePeople`. Up to 3 first names, relation **`friend`**, `notes = "trusted_circle"`. Idempotent on existing non-self name. **No facts/signals** until chat or later intake. Skip is allowed (empty circle).

**Fitting Tell-me box:** LLM prefills wizard fields (`fitting-tell.ts`). Does not write fashion-memory directly; those fields hit Store B then seed.

**Photo / fit / scan / stylist verdict:** full field map in **§11**. Headline: face-scan JSON and the stylist verdict stay on `PhotoAnalysis`. Height/build **do** persist on `SizingProfile` + avatar attributes; they are **not** seeded as fashion `measurement` / `size` facts. Clothing sizes are **not asked** on the live wizard (schema columns exist; chat still asks at intake).

### 3.2 Extra notes LLM → Store B → re-seed self

**When:** optional notes after profile review (`OnboardingExtraNotesJob`).

**Owner:** `memory-extract/extractor.ts` + `projector.ts`, then `seedOnboardingIntoFashionMemory` again.

This is the **only live caller** of `extractOnboardingProfile`. It is **not** the fashion-chat clerk.

It can write `OwnedProduct`, `Recipient`, `ShoppingIntent`, category/brand/taste, sizing, hard negatives. Identity fields (name, age, gender, pronouns, birth date) are stripped — those are onboarding/settings only.

`Recipient` rows from this path **do not** become `people`. Gift shopping still needs Store A roster (mentions / extraction / circle).

### 3.3 Chat extraction (async clerk) — Store A, any person

**When:** after the fashion SSE stream closes. Never blocks the reply.

| Actor | Entry |
|-------|--------|
| Auth | `spawnDetachedFashionExtraction` → `runFashionExtraction` |
| Guest | `scheduleGuestFashionExtraction` → `POST /api/fashion-memory/extract-ops` then `applyLocalFashionOps` |
| Sweep (idle / next visit) | `sweep: true` skips the short-ack gate so deferred “Medium” answers still land |

**Does not run for guests on the server** (`isGuestUserId` / non-Supabase id → skip). Guest clerk is client-side.

**Pipeline** (`extraction/runner.ts`):

1. Concurrent-run lock (60s).
2. Load messages **after watermark** (`extraction_runs.last_message_id` of last `done` run).
3. **Cost gate** (unless sweep): if newest user text is a short ack (`yes`/`ok`/`thanks`/`the first one`/len < 15) **and** the preceding assistant was **not** soliciting (`?` or `ask_clarification`) → skip, **watermark stays put** (data is not dropped).
4. Assemble context: full roster, snapshots for self + mentioned + sticky people, last **10** messages tagged `[CONTEXT]` / `[NEW]`.
5. LLM (`FASHION_MEMORY_EXTRACTOR_MODEL`, temp 0) forced tool `record_fashion_ops`.
6. `applyFashionOps` — application layer accepts/rejects.
7. `runRequestEventCorroboration` on **self** (see §3.6).
8. Finish run; watermark advances.

Prompt procedure (full text: `docs/fashion/extraction.md`):

1. **Person or item?** Item-only specs are not recorded. “I always wear black” is a person claim. Short answers inherit the assistant’s question.
2. **Which person?** Name / relation aliases / pronoun. Ambiguous → `ambiguous_subjects`, **record nothing**. Missing person → `new_person` first, then attach ops to `new:1`.
3. **Known / general / this-purchase-only?** Known → `noop_confirm`. General → fact/signal. This purchase only → nothing. Dislikes while shopping generalize more readily than positive picks.

**Ops the clerk may emit:**

| Op | App-layer rule |
|----|----------------|
| `new_person` | Evidence must be in `[NEW]` text. Duplicate relation alias remaps `new:N` to existing id (facts still attach); create is rejected as `duplicate_relation_alias` |
| `fact_add` | Upsert; measurements force `garment_type = metric` |
| `fact_reverse` | Rejected unless active fact’s value equals `old_value` |
| `signal_add` | `stated` → active; `inferred` → candidate |
| `signal_reverse` | Rejected if reversing **stated** with **inferred**; else supersede + insert |
| `context_split` | New signal in `new_context_label`; original kept |
| `noop_confirm` | Bump signal confidence, or ack existing fact |

Every op needs `evidence_quote` substring-matching a `[NEW]` user line, else `evidence_not_in_new_messages`.

The clerk **must not** record current-request attributes (“a black shirt”). Those go to `request_events` from the brief (§3.6).

### 3.4 Sync writes during the turn (same conversation, before/with search)

These land **this request**, so intake/search do not wait for the clerk.

| Path | What |
|------|------|
| `applyStatedFacts` | Router `stated_facts`: department + sizes (+ new person). Latest wins; logs `in_conversation_contradiction`; never asks her to resolve |
| `apply-intake-reply` | Clarification chip/text answers → size / department facts on the **target person** |
| `ensureMentionedPeople` | Regex gift cues (`for my mother`, `my dad`, …) **create roster rows before the router LLM** so sizes do not land on self |
| `resolveBriefRecipientPersonId` | Code resolves recipient from roster / gift cue; **never trust the LLM to invent a person id** |

Gift-cue regex (canonical map in `people-from-mentions.ts`): mother/mom/mum/mama, father/dad/daddy, wife, husband, sister, brother, girlfriend, boyfriend, son, daughter, grandmother/grandma, grandfather/grandpa, aunt, uncle, niece, nephew. **Friend/colleague omitted** here (too ambiguous without a name); extractor `new_person` can still create them.

### 3.5 Rail / pick / try-on interactions → signals on **self**

**Not** the recipient. `writeInteractionSignal` / `writeFashionPickAcceptance` always `ensureSelfPerson`.

| Kind | Polarity | Source | Confidence | Notes |
|------|----------|--------|------------|-------|
| `tier1_expand` | + | inferred | 0.2 | color + style only |
| `tier2_promote` | + on chosen, − on demoted | inferred | 0.4 / 0.2 | |
| `tier1_reject` | − | rejection | 0.5 | active |
| `look_swap` | + chosen, − swapped-out | inferred / rejection | 0.3 | |
| `tier3_verify` | + | inferred | 0.2 | color + style |
| `outbound_click` | + | inferred | 0.7 | strongest behavioral like |
| `tryon_tap` | + | inferred | 0.3 | `run-single.ts` |
| `recurate` | — | — | — | `request_event` only, not a signal |
| `show_more` | — | — | — | no write |
| pick-signal API accept | + | inferred | 0.45 | candidate |
| pick-signal API reject | − | rejection | 0.7 | active |

Attributes come from **normalized catalog fields** (color/style/brand/material/pattern/garment), never raw titles. Deduped per `(search_id, interaction, ref)`. Guests: no write.

This is the live stand-in for “she engaged with / rejected this find.” It is **not** a purchase.

### 3.6 Request events + corroboration (not “bought”)

On `ready_to_search`, `writeRequestEventFromBrief` logs episodic attributes (garment, color, occasion, style, brand, …) on the **resolved recipient**.

Corroboration (`extraction/corroboration.ts`), run after each extraction on **self**:

- Group request attributes → signal type/value.
- Promote only if **≥ 3 events** across **≥ 2 conversations**.
- 3–3 events → `candidate` inferred confidence 0.4.
- ≥ 4 events → `active` inferred confidence 0.55.
- **Request attributes never become signals directly.**

So “she asked for navy three times in two threads” can become an inferred color like. One funeral-black ask does not.

### 3.7 Moodboard — **no extraction**

Moodboard is try-on persistence + Studying Scan + Ask votes + buyable catalog refs (`moodboard-context.ts`, `MoodboardView`).

It does **not** call extraction, seed, pick-signal, or corroboration. Owner/friend votes stay on `LookAskShare`. A saved look is not a taste signal.

`tryon_tap` (fitting-room try-on from a find) **does** write a weak inferred self signal. Pinning that look to the moodboard does not write another one.

### 3.8 Bought / checkout / owned — **almost none live**

Rye / Shopify merchant handoff cannot correlate `userId`. **Rye confirm
(completed)** is the first-party success surface: cart line metadata carries
`searchId` (assistant message id) + `ref` from add-to-cart; confirm (and GET
when already completed) call `completeCheckoutPurchase` → `writePurchaseMemory`.
Guests get a payload the client applies via `persistGuestFashionPurchase`.
Missing `search_id` writes `[PILOT][P0] purchase_memory_missing_search_id`
to `pilot_alerts` and `console.error` (`docs/fashion/pilot.md`).
(`console.error`) and writes nothing. The write is idempotent on `(search_id, ref)`.

**Pilot constraint:** visit-2 purchase memory only exists if checkout went
through the first-party Rye flow. Merchant-handoff orders write nothing — the
ten real users must check out in-app. See [`pilot.md`](./pilot.md).

| Surface | Writes fashion-memory? |
|---------|------------------------|
| Rye confirm / retrieve when `state=completed` | **Yes** — purchase event on the originating search recipient + stated 0.9 attrs |
| Shopify merchant handoff | **No** — cannot correlate userId |
| Order confirmed page | No additional write |
| Cart add | Stamps `searchId` / `ref` on line metadata only |
| `OwnedProduct` from extra-notes LLM | Store B only; seed does **not** copy owned products into facts/signals |
| Extractor `signalType: purchase` / `product_return` | Only on extra-notes path → `OwnedProduct` |
| `outbound_click` | Weak inferred like on self (she left to a PDP), not a buy |

Do not treat wardrobe language as inventory. Router `request_type: capsule` is a search mode, not a closet.

---

## 4. People — roster, identity, preferences

### 4.1 Roster rules

- Every auth user gets a `relation='self'` row (`ensureSelfPerson`, also SQL trigger fallback).
- `relation` is the identity key. **Relation beats name.** Brother Gabriel ≠ son Gabriel. Labels are `relation (Name)` so two Gabriels stay distinct.
- Unique family roles (one slot unless you later add a second with a name): mother, father, wife, husband, girlfriend, boyfriend, grandmother, grandfather. Aliases collapse (`mom`/`mama`/`ماما` → mother, `teta`/`تيتا` → grandmother, …). Full map: `extraction/relation-aliases.ts`.
- Non-unique (friend, colleague, son, daughter, sister, brother, …): merge only on **same canonical relation + same name**. Cross-bucket “friend Sam vs colleague Sam” → `ambiguous_subject`, do not auto-merge.
- First unnamed person of a relation can receive a later name (`resolvePerson` singleton attach). A **second** son needs a name.
- Friend/colleague are **not** auto-created from “my friend” mentions (too vague). Circle step creates named friends. Extractor may `new_person` when the utterance is specific.

### 4.2 How a person appears

```
onboarding complete     → ensureSelfPerson + seed facts/signals
circle step             → friend rows, names only
user says "for my mom"  → ensureMentionedPeople BEFORE router
router stated_facts.new → resolvePerson (create or attach)
extractor new_person    → createPerson (or remap alias)
intake clarification    → facts on target_person_id (already on roster)
```

Identity gate (`intake/identity-gate.ts`) runs **after** recipient is a real roster id. Missing department/sizes block search with questions **for that person**. Account hints apply **only** if `person.relation === "self"` (`intakeHintsForRecipient`).

Department without a stored fact:

- Strong relation → `departmentFromRelation` (mother → womens, father → mens). Friend/colleague/self → no inference.
- Kids age language (“8 year old son”) → boys/girls/baby via `inferKidsDepartmentFromMessage`.
- Else ask “which section.”

Sticky recipient: last assistant brief `recipient_person_id`, else last `request_event` for this conversation. Ambiguous later turns keep shopping for the same person.

### 4.3 Preferences are per person

Self and mom have **separate** `fashion_facts` / `style_signals`.

| Who | How taste gets there |
|-----|----------------------|
| Self | Onboarding seed + chat extraction + rail interactions + corroboration of **self** request events |
| Gift person | Chat extraction on that `person_ref` + sync stated_facts / intake answers. **Not** onboarding. **Not** rail interactions (those always self). **Not** corroboration (self only) |
| Circle friend | Roster only until someone shops for them or states a fact |

Planner/curation load `buildRecipientProfileBlockForPlanner` for `brief.recipient_person_id` — that person’s facts/signals only.

Honesty/tone from self onboarding meta still styles the **shopper’s** voice even when the recipient is someone else.

### 4.4 Ambiguity and conservatism

If two roster people could match, **write nothing**. Recovering a missed fact is cheaper than attaching mom’s size to the shopper.

Do not create a duplicate when an existing alias might match. Application layer remaps `new:N` in that case.

Pronouns resolve to the most recently established referent in the extraction window. If unsure → ambiguous_subject.

---

## 5. How memory is **read** (so you know what extraction is for)

Pre-search (`assembleRouterContext`):

1. Ensure self; maybe inline-seed onboarding.
2. Ensure mentioned gift people.
3. Load all people + their active facts + active/candidate signals.
4. Last 12 messages to the router LLM.
5. PROFILES for self + sticky/mentioned people (`formatRouterPersonProfile`): department, sizes (facts + account lines for self), fit, no-gos, budget, ranked signals, recent request-event picks, onboarding context/tone/aspires lines for self.

Signals are occasion-ranked (`work`/`event`/`gym`/…) then truncated. Worn-grid tags sit in context `everyday`; steal-grid in `elevated`.

Search planner receives the **recipient** profile block, not the shopper’s, unless recipient is self.

Scoring does **not** re-query style_signals. Palette/brand/style from the **brief** (which the router filled from profile vs stated). Hard drops use recipient department + sizes, never “she liked navy last month” as an eligibility rule.

---

## 6. Guest vs auth

| | Guest | Auth |
|--|-------|------|
| Storage | `FashionLocalStore` / localStorage | Supabase fashion tables |
| Extraction | Client idle → `/api/fashion-memory/extract-ops` | Detached server runner |
| Mentions | `ensureMentionedPeopleLocal` | `ensureMentionedPeople` |
| Interactions / pick-signal | No | Yes |
| Sign-in | `migrateGuestFashionMemoryToUser` + Prisma user-id reassignment | — |

Guests can still accumulate people/facts/signals locally; they are not lost on the clerk path. They **are** lost for rail-interaction likes until signed in.

---

## 7. Precedence (when two writes collide)

1. **Stated > rejection > inferred > request.** Inferred cannot reverse stated. Inferred cannot overwrite a stated row (upsert returns the stated row).
2. **This-turn stated_facts / intake answers** beat stale DB for the identity gate (merged as conversation facts). Extraction later upserts the same values (idempotent).
3. **Latest fact wins** on same `(person, type, garment)`. History is `superseded`.
4. **Context split** over reverse when slim-for-work vs loose-for-gym.
5. **Gift cue in the user message** beats a brief that still points at self.
6. **Account sizing** fills gaps for self only; fashion `size` facts still display alongside `(account)` lines.

---

## 8. Agent do / don’t

**Do**

- Attach every fact to a roster `person_ref` (short id without `#`, or `new:N` after `new_person`).
- Treat short answers to size/department/who-for as stated facts about that person.
- Record stable dislikes (“I hate big logos”) as `signal_add` polarity −1.
- Create people from clear gift language; ask for a name when a second son/friend would collide.
- Read PROFILES for the **recipient** when judging a find.

**Don’t**

- Copy shopper sizes onto a recipient, or the reverse.
- Record “black shirt this time” as a color like.
- Assume moodboard, Ask votes, checkout, or owned-product rows feed the router.
- Assume Prisma `Recipient` is the roster.
- Reverse a stated like from a tap/click.
- Invent a numeric budget from value philosophy.
- Add a second extractor (Haiku, curator ban, keyword coerce) because memory “missed” an item spec — that is a request_event, not a clerk miss.
- Consume `measurement` facts in scoring/search (reserved).
- Treat face-scan traits (undertone, face shape, hair) or stylist-verdict `shopping_engine_profile` as live chat prefs — they are not seeded.
- Treat Studying Scan (try-on look-scan) checks as memory writes — they are a one-shot judgment stored on the generation.

---

## 9. File map

| Path | Role |
|------|------|
| `src/lib/fashion-memory/extraction/runner.ts` | Auth clerk orchestration |
| `src/lib/fashion-memory/extraction/spawn.ts` | Fire-and-forget after SSE |
| `src/lib/fashion-memory/extraction/gate.ts` | Short-ack cost gate |
| `src/lib/fashion-memory/extraction/llm-extract.ts` | LLM + tool parse |
| `src/lib/fashion-memory/extraction/apply-ops.ts` | Accept/reject ops |
| `src/lib/fashion-memory/extraction/corroboration.ts` | Request → inferred signal |
| `src/lib/fashion-memory/extraction/person-identity.ts` | Labels, single-relation match, name ambiguity |
| `src/lib/fashion-memory/extraction/relation-aliases.ts` | Alias collapse + duplicate guard |
| `src/lib/fashion-memory/people.ts` | CRUD / resolvePerson |
| `src/lib/fashion-memory/people-from-mentions.ts` | Pre-router gift roster |
| `src/lib/fashion-memory/intake/identity-gate.ts` | Department/size blocking asks |
| `src/lib/fashion-memory/intake/apply-stated-facts.ts` | Sync stated_facts |
| `src/lib/fashion-memory/router/assemble-router-context.ts` | ROSTER/PROFILES + mention ensure + seed |
| `src/lib/fashion-memory/router/llm-router.ts` | `resolveBriefRecipientPersonId` |
| `src/lib/fashion-memory/search-planner/recipient-profile.ts` | Planner profile block |
| `src/lib/fashion-memory/curation/interaction-signals.ts` | Rail → self signals |
| `src/lib/fashion-memory/direct-writes.ts` | Pick accept/reject API |
| `src/lib/onboarding/seed-fashion-memory.ts` | Prisma → self facts/signals |
| `src/lib/onboarding/trusted-circle.ts` | Circle → friend people |
| `src/lib/onboarding/memory-extract/*` | Extra-notes LLM only |
| `src/lib/fashion-memory/client/spawn-extraction.ts` | Guest clerk |
| `src/lib/fashion-memory/local/store.ts` | Guest snapshot |
| `src/lib/photo-analysis/run.ts` | Face-scan runner (display only) |
| `src/lib/photo-analysis/review.ts` | Scan-check confirm/correct |
| `src/lib/photo-analysis/verdict.ts` | Onboarding stylist verdict |
| `src/lib/tryon/look-scan-verdict.ts` | Try-on Studying Scan (reads Store B, writes generation JSON) |

---

## 10. Quick “where did this preference come from?”

Work backwards:

1. Is it on a **non-self** person? Then onboarding/circle/interactions/corroboration are out. Chat extraction, stated_facts, or intake answers only (plus mention-created empty person).
2. Is `source_quote` prefixed `onboarding:`? Seed from wizard / extra-notes projection.
3. Is `source` `rejection` or low-confidence `inferred` with no quote? Rail interaction or pick-signal.
4. Is it a `candidate` color/style that matches many `request_events`? Corroboration.
5. Is it only in Prisma `OwnedProduct` / `Recipient` / `TasteTag` and missing from `style_signals`? Projection never copied it (owned/recipient) or seed category was filtered.
6. Face-scan / stylist verdict / look-scan? See §11. Almost never Store A.

If you cannot point to a row in §3 or §11, **it was not extracted into chat prefs.**

---

## 11. Onboarding, face scan, and verdicts — every field

Live wizard order: `consent` → `photo` → `name` → `life` → `spend` → `fit` → `worn` → `wanted` → `nolist` → `honesty` → `circle` → `verdict` (scan-check then card). Script: [`../onboarding/questions-for-agents.md`](../onboarding/questions-for-agents.md).

**“Used in user prefs?”** here means: does fashion **chat** (router / intake / planner / scoring) see it as a self fact or signal after seed? Other consumers are listed separately so you do not confuse “we collected it” with “the shopper uses it.”

| Column | Meaning |
|--------|---------|
| **Chat prefs** | Seeded to Store A self (`fashion_facts` / `style_signals` / `people`) and read by the router |
| **Account hints** | `loadIntakeProfileHints` — self department / clothing sizes / name, even before seed |
| **Look-scan in** | Studying Scan (try-on) prompt reads Store B via `getOnboardingStatus` |
| **Twin** | Avatar attributes / FASHN silhouette — visual try-on, not catalog eligibility |
| **Verdict LLM** | Onboarding stylist-verdict generator (`assembleVerdictInput`) — writes `PhotoAnalysis.verdict`, not Store A |
| **Display** | Fitting card / scan-check UI only |

There are **two different “scans” and two different “verdicts.”** Do not mix them.

| Name | When | Store | Writes chat prefs? |
|------|------|-------|-------------------|
| **Face scan** | Onboarding photo (`runPhotoAnalysis`) | `PhotoAnalysis.gate` + `.result` | **No** |
| **Scan-check** | Verdict step 12a — user confirms/edits face traits + re-confirms body | `PhotoAnalysis.userReview` (+ may PATCH `SizingProfile` height/build) | Body numbers: **SizingProfile only**, not seeded. Face traits: **No** |
| **Stylist verdict** | After scan-check, Fitting card | `PhotoAnalysis.verdict` (huge JSON incl. `shopping_engine_profile`) | **No** |
| **Studying Scan / look-scan** | Dressed try-on look | `TryonGeneration.inputRefs.shoop_verdict` | **No** (reads prefs; does not write them) |

`photo-analysis/run.ts` is explicit: results are stored and displayed only. Do not import that module from fashion-memory, hard-drops, scoring, or curation.

---

### 11.1 Consent + photo file

| Field | Stored | Chat prefs? | Also |
|-------|--------|-------------|------|
| Age attestation (`ageAttested`) | Session / consent gate | **No** | Legal gate to continue |
| Own-photo attestation | Session / biometric consent | **No** | Legal |
| Guest abandon-delete ack | Session | **No** | Legal |
| Face photograph | Avatar source + `PhotoAnalysis` (hashed) | **No** | Twin + face scan. Coverage locked to `face`. Skip allowed |

---

### 11.2 Name step (identity)

| Field | Prisma | Chat prefs? | Also |
|-------|--------|-------------|------|
| `preferredName` | `UserProfile` | **Yes** — `people.name` on self | Account hints; look-scan name line; roster |
| `genderPresentation` | `UserProfile` | **Yes** — `gender_presentation` fact (`masculine`→mens, `feminine`→womens, androgynous / prefer-not / nonbinary→`mixed`) | Account hints (skip department ask); outfit-grid bucket; comfort/brand suggestion gate |
| `birthDate` | `UserProfile` | **No** as a date | Derives `ageRange`; legal ≥13; never shown; not a signal |
| `birthDateSkipped` | flag | **No** | |
| `styleEra` (CSV of era chips) | `UserProfile` | **Indirect** — inside `body_note` onboarding-meta; router `context:` line (era shorthand) | Feeds `ageRange` if no DOB; look-scan; verdict LLM |
| `ageRange` (derived, never asked) | `UserProfile` | **Indirect** — `body_note.age_range`; router context (`teen` / `30s` / …) | Server required to complete |

---

### 11.3 Life step

All optional. `lifestyleTags` are **derived** from week + kids — not a separate WORLD chip screen.

| Field | Prisma | Chat prefs? | Also |
|-------|--------|-------------|------|
| `weekIs` | `UserProfile` | **Indirect** — `body_note.week_is` → router `context:` | Verdict LLM lifestyle domain |
| `dressingFor` | `UserProfile` | **Indirect** — `body_note.dressing_for` → router `context:` | Verdict LLM `goal` |
| `kids` | `UserProfile` | **Indirect** — `body_note.kids` (omitted from context if `none`) | Derives `kids_in_the_mix` tag |
| `climate` | `UserProfile` | **Indirect** — `body_note.climate` → router `context:` | Verdict LLM; **not** a hard fabric filter in search |
| `lifestyleTags` (derived) | `UserProfile` | **Indirect** — `body_note.lifestyle_tags` → router `context:` | Look-scan lifestyle line |

These are **taste context**, not hard drops. Chat will not refuse a coat because `climate=hot_humid`; the router may lean.

---

### 11.4 Spend

| Field | Prisma | Chat prefs? | Also |
|-------|--------|-------------|------|
| `valuePhilosophy` (chips, CSV; custom as `custom:…`) | `UserProfile` | **Indirect** — `body_note.value_philosophy` + inferred `aesthetic` signals (`quiet luxury`, `quality first`, `value conscious`, `design led`, confidence 0.55, source inferred) | Look-scan; verdict LLM. **Never** a numeric `budget_band` |
| Currency / country / city | Schema exists | **No on live wizard** | Defaults may exist; not asked. Extra-notes LLM can fill Store B; seed does **not** copy location into facts |

---

### 11.5 Fit step (typed body) + twin

Saved on `savePhotoAndAttrs` / scan-check `persistScanBody`.

| Field | Prisma / avatar | Chat prefs? | Also |
|-------|-----------------|-------------|------|
| Height (`heightCm`) | `SizingProfile.heightCm` + avatar `height_band` | **No** (not seeded as `measurement`) | Twin silhouette; verdict LLM `measurements.body`; scan-check reconfirm |
| Weight (`weightKg` or skipped) | `SizingProfile.weightKg` | **No** | Verdict LLM; never shown in chat PROFILES |
| Build (`bodyType`: slim/average/athletic/broad/plus) | `SizingProfile.bodyType` + avatar `build` | **No** | Twin; verdict LLM |
| Definition (`muscularity`) | **Not** a SizingProfile column. Avatar `muscularity` (+ `confirmed_body`) | **No** | Twin prompt. Default inferred from build if skipped |
| Shape (`bodyShape`) | **Not** SizingProfile. Avatar `body_shape` (+ `confirmed_body`) | **No** | Twin prompt; verdict LLM |
| Bust (`bustFullness`, feminine only) | Avatar `bust_fullness` (+ `confirmed_body`) | **No** | Twin visual only — not cup size, not a size fact |
| Legs (`legLine`) | `confirmed_body.leg_line` only | **No** | Verdict LLM. **Not** copied onto avatar attributes |
| Units (cm/ft, kg/lb) | `UserProfile.unitsLength` / `unitsWeight` | **No** | Display |

If the user later **says** “I’m 180cm” in chat, the extraction clerk may write `measurement` — still reserved; scoring must not consume it. Fit-step numbers do not auto-create that fact.

**Clothing sizes** (`topUsualSize`, bottoms, shoe): **not asked** on the live wizard. If present (profile editor / extra-notes), seed **does** write `size` facts and account hints skip those buckets.

---

### 11.6 Worn / wanted grids

| Field | Prisma | Chat prefs? | Also |
|-------|--------|-------------|------|
| Worn looks (max 3) | `TasteTag` category `worn` | **Yes** — style/color/material/silhouette signals, context `everyday` | `styleMix`; verdict LLM wardrobe.worn; look-scan taste loves |
| Steal / wanted looks (max 2) | `TasteTag` category `aspirational` | **Yes** — same types, context `elevated` | `styleMix`; verdict LLM wardrobe.wanted |
| `styleMix` (computed donut) | `UserProfile.styleMix` | **Indirect** — `body_note.style_mix` | Fitting card; verdict LLM. Not a search filter |
| Compliment chips | Persist path exists; **no live step** | If present: `body_note.compliment_preferences` + taste signals category `compliment` | Tell-me can fill |

Grid cards are catalog looks, not a closet. Picking “hoodie + joggers” seeds tags, not an `OwnedProduct`.

---

### 11.7 Nolist (brands, comfort, vetoes)

| Field | Prisma | Chat prefs? | Also |
|-------|--------|-------------|------|
| Brand loves | `BrandPreference` sentiment `love` | **Yes** — `brand` signal polarity +1, stated, 0.85 | Look-scan; verdict LLM |
| Brand avoids | `BrandPreference` sentiment `avoid` | **Yes** — polarity −1 | Look-scan; hard-drops only if later classified as no_go — **brand avoids are signals, not hard-drops** |
| Comfort lines (`no heels`, `no tight fits`, …) | `HardNegative` scope `fit`, `note: comfort` + `SizingProfile.sensitivities` | **Yes as `no_go`** — seed classifies the **value** (heels→garment, leather→material, else style). Sensitivities array itself is **not** seeded | Look-scan hard no-list line; verdict LLM comfort |
| Style vetoes (`Never put me in…`) | `HardNegative` scope `style`, reason `taste` | **Yes** — `no_go` facts | Look-scan; verdict LLM |

Comfort is the closest onboarding analogue to a hard filter. It still goes through `classifyHardAvoid` on the string, not a dedicated comfort engine.

---

### 11.8 Honesty + circle

| Field | Prisma / people | Chat prefs? | Also |
|-------|-----------------|-------------|------|
| `honestyPreference` (`straight` / `no_mercy`; legacy `gentle`→`straight`) | `UserProfile` | **Indirect** — `body_note.honesty_preference` → router **tone** line and curator voice. Does not change what is eligible | Look-scan voice; verdict LLM |
| Trusted circle (up to 3 first names) | `people` relation `friend`, `notes=trusted_circle` | **Roster only** — no facts/signals | Ask-your-friends targeting later. Not gift recipients until someone shops for them |

Honesty is **how we talk**, not what we pull.

---

### 11.9 Face scan (vision JSON)

`POST /api/onboarding/photo-analysis` → `PhotoAnalysis`. Engine `style-photo-v4`. Onboarding does not run partial analysis.

**Preflight (`gate`):** person presence, photo type, coverage, retake/reject. UI only.

**Result (`StylePhotoAnalysis`) — none of this is seeded:**

| Block | Examples | Chat prefs? |
|-------|----------|-------------|
| `capture_quality` | lighting, filters, pose | **No** |
| `visible_profile.color` | skin tone, undertone, contrast, hair/eye color, seasonal palette hypothesis | **No** |
| `visible_profile.face` | primary shape, jaw, forehead, … | **No** |
| `visible_profile.hair_and_grooming` | length, facial hair, eyewear | **No** |
| `visible_profile.body_proportions` | frame, shoulder, torso/leg, posture, muscular distribution | **No** (user-typed fit step is the body source of truth) |
| `current_style_signals` | silhouette/formality of **clothes in the photo** | **No** — outfit in the selfie is not wardrobe memory |
| `outfit_analysis` | per-garment fit_status | **No** |
| `preliminary_styling_implications` | prefer/explore guidance | **No** |
| follow-ups / missing / requested measurements | | **No** — not asked as extra wizard steps |
| `final_summary` | | **No** |

Scan-check (12a) lets the user confirm/edit a **short** trait list (skin, undertone, contrast, eyes, hair, face shape, hair length, facial hair) plus re-confirm height/weight/build/definition/shape. Saved as `userReview`: `confirmed_paths`, `corrections`, `rejected_paths`, `notes`, `confirmed_body`.

| Review action | Chat prefs? |
|---------------|-------------|
| Confirm/correct undertone, face shape, hair, … | **No** — stays on `userReview` for the stylist-verdict LLM |
| Re-confirm height/build/weight | **SizingProfile** update only — still **not** seeded to Store A |
| Skip scan-check | Verdict LLM may be skipped/blocked; onboarding can still complete |

---

### 11.10 Onboarding stylist verdict (Fitting card)

Generated by `generateStylistVerdict` from: photo analysis + user review + questionnaire + measurements + wardrobe inventory. Stored on `PhotoAnalysis.verdict`.

**Agent briefing (jobs, payloads, UI field map):** [`../onboarding/verdict-page-pipeline.md`](../onboarding/verdict-page-pipeline.md). Live call uses `STYLIST_READING_SCHEMA` — not the full shopping-engine catalog.

Includes (among others): `executive_verdict`, `style_identity`, `color_system`, `proportion_and_silhouette`, `size_and_fit`, `garment_playbook`, `fabrics_patterns_and_climate`, `grooming_and_accessories`, `outfit_formulas`, `wardrobe_plan`, **`shopping_engine_profile`** (hard_constraints, soft_preferences, positive/negative search terms, automatic_rejection_rules, …), `user_facing_verdict` (title, golden_rules, mistakes_to_avoid, first_five_actions).

| Output | Chat prefs? | Also |
|--------|-------------|------|
| `user_facing_verdict` copy | **No** | Fitting card reading |
| `golden_rules` / palette / silhouette chapters | **No** | Card + `verdict-reading.ts` display |
| `shopping_engine_profile` | **No — not wired to search/planner/scoring** | `reading-looks.ts` turns some of it into **catalog queries for the reading card only** (illustrative products on the verdict UI). Those finds are not stored as signals |
| Reading-card product images | **No** | One-shot display |

Do not patch the planner to “just read `shopping_engine_profile`.” That would bypass layer ownership. If a golden rule should become a no_go, it must be a **user-stated** veto or a seed from `HardNegative`, not a silent copy from this JSON.

---

### 11.11 Studying Scan (try-on look-scan) — different product

When she dresses the twin, `runLookScanVerdict` judges **that look**: fit / palette / nolist checks, title, body, whispers, optional Ask vote.

**Reads** Store B (`getOnboardingStatus`): name, presentation, age/era, spend, honesty, lifestyle tags, compliments, brand like/avoid, hard negatives, taste tags, clothing sizes if any.

**Writes** `TryonGeneration.inputRefs` (`shoop_verdict`, `shoop_vote`). Moodboard and Ask show it.

| Output | Chat prefs? |
|--------|-------------|
| `checks.fit` / `palette` / `nolist` | **No** |
| `verdict_title` / body / whispers | **No** |
| Mapped Ask vote (`love` / `almost` / …) | **No** (share votes are not signals) |
| Owner tapping try-on on a **chat find** (`tryon_tap`) | **Yes, separately** — weak inferred self signal from catalog attributes (§3.5). The scan text is not the write |

A fail on “palette” does not create a color dislike. A pass does not create a color like.

---

### 11.12 Not on the live wizard (do not treat as collected)

Country, city, currency, top/bottom/shoe size, occupation, WORLD_OPTIONS chips as questions, compliment-chip step, `gentle` honesty tile, numeric budget, full-body photo coverage.

Schema columns may still exist. Extra-notes / profile editors can fill them; only then does seed (sizes, brands, tags, hard negatives, onboarding-meta) apply.

---

### 11.13 One-page cheat sheet

```
CONSENT / PHOTO FILE          → legal + twin + face-scan store     → NOT chat prefs
NAME / GENDER / ERA / AGE     → UserProfile → seed name+dept+body_note context  → YES / indirect
LIFE (week, dating, kids, climate) → body_note context line        → indirect (not hard drops)
SPEND PHILOSOPHY              → body_note + weak aesthetic signals → yes (soft)
HEIGHT / WEIGHT / BUILD / SHAPE / BUST / LEGS
                              → SizingProfile and/or avatar / confirmed_body
                              → NOT seeded; twin + verdict LLM only
WORN / STEAL GRIDS            → TasteTag → style signals           → YES
BRANDS / COMFORT / VETOES     → BrandPreference / HardNegative → signals + no_gos → YES
HONESTY                       → body_note tone                     → voice only
CIRCLE NAMES                  → people friends                     → roster, no taste
FACE-SCAN JSON + SCAN-CHECK TRAITS → PhotoAnalysis                 → NOT chat prefs
STYLIST VERDICT JSON          → PhotoAnalysis.verdict              → NOT chat prefs
LOOK-SCAN (dressed twin)      → generation JSON                    → reads prefs, writes none
CLOTHING SIZES                → not asked here; chat intake / extra-notes
```

