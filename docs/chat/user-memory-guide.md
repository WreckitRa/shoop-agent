# Shoop User-Knowledge & Memory Guide (V2)

> The edge of Shoop is **not** that it remembers facts. It remembers a *person*.
>
> Facts are flat. A name is a fact. A name + body + lifestyle + taste + budget
> psychology + recent purchases + upcoming wedding + spouse profile = a **client**.
>
> This document is the source of truth for what we capture about that client,
> how we capture it, where we store it, and how the agent uses it.

---

## 0. The core loop

```
observe → extract → store evidence → promote to canonical memory →
project into typed tables → retrieve relevant context → personalize search →
learn from feedback
```

Three storage layers, in order of trust:

1. **`MemoryObservation`** — raw extracted signals from every shopping-relevant
   message. Append-only evidence trail. Never deleted by the agent.
2. **`ShoppingMemory`** — canonical promoted facts. Merged, scored, deduped.
   Old evidence is preserved as `evidenceObservationIds`.
3. **Typed projections** — fast, editable, deterministic tables the agent
   reads at retrieval time and the user edits in the profile UI:
   `UserProfile`, `SizingProfile`, `CategoryPreference`, `BrandPreference`,
   `Recipient`, `ShoppingIntent`, `TasteTag`, `HardNegative`.

Projections can be rebuilt at any time from the raw observations.

---

## 1. The 13-layer client knowledge model

A real luxury personal shopper / concierge / Stitch Fix stylist captures the
same 13 layers about every client. This is what Shoop captures too.

| # | Layer | Where it lives | Status |
|---|-------|----------------|--------|
| 1 | Identity & Context | `UserProfile` | ✅ implemented |
| 2 | Body & Sizing | `SizingProfile` | ✅ implemented |
| 3 | Lifestyle & Identity | `UserProfile.{occupation, workEnvironment, lifestyleTags, climate, …}` | ✅ implemented |
| 4 | Aesthetic & Taste | `CategoryPreference` + `TasteTag` (taste graph) | ✅ implemented |
| 5 | Brand Relationship Graph | `BrandPreference` (per user × brand × category) | ✅ implemented |
| 6 | Budget & Value Philosophy | `UserProfile.valuePhilosophy` + `CategoryPreference.budget*` | ✅ implemented |
| 7 | Decision & Shopping Personality | `UserProfile.{decisionStyle, riskTolerance, dealSensitivity, qualityThreshold}` | ✅ implemented |
| 8 | Active Intents (Missions) | `ShoppingIntent` | ✅ implemented |
| 9 | Owned Products | `ProductInteraction` (action="purchased") + signal `product_owned` | ✅ implemented |
| 10 | Purchase & Feedback History | `ProductInteraction` (extended via webhooks) | ✅ implemented |
| 11 | Recipient / Gift Profiles | `Recipient` | ✅ implemented |
| 12 | Logistics | `UserProfile.{shippingCountry, acceptsInternational, preferredDeliverySpeed}` | ✅ implemented |
| 13 | Hard Negatives / Constraints | `HardNegative` (typed rules) | ✅ implemented |

---

## 2. The four extraction modes

A great personal shopper uses four modes. We use the same four.

### A. Onboarding intake (proactive)  &nbsp; — **DEFERRED**
A natural 4–6 turn mini-interview on first chat to cover the highest-ROI
fields with the lowest friction (name, country, gender presentation, top 1–2
style descriptors, hard negatives).
**Design** — see §11 below. Not implemented yet.

### B. Inline conversation extraction (passive)  &nbsp; — ✅
Every user message flows through the gate → classifier → LLM extractor →
writer → projector → summary refresher pipeline.
Implementation: `src/lib/ai-chat/shopping-memory/`.

### C. Behavioral inference (passive)  &nbsp; — ⚠ partial
Product interactions (`shown`, `clicked`, `dismissed`, `saved`, `purchased`,
`returned`) update `ProductInteraction`.
**Pending**: a learning loop that promotes repeated behavior to canonical
memories ("dismissed 5 chunky sneakers → likely dislikes chunky").

### D. Just-in-time probes (active by agent)  &nbsp; — ✅
When the current query needs a missing field, the gap detector emits a small
list of natural-language questions for the agent to weave into its reply.
Asked once, then stored forever (no nag loops).
Implementation: `src/lib/ai-chat/shopping-memory/gap-detector.ts`.

---

## 3. The data model in one picture

```
                                                 (V1 layers — already shipped)
                                                 ─────────────────────────────
  user message ──► gate ──► classifier ──► extractor ──► writer ──► MemoryObservation
                                                              │
                                                              └─► ShoppingMemory
                                                              │
                                                              └─► ShoppingProfileSummary
                                                                  (compressed bullets)


                                                 (V2 layers — typed projections)
                                                 ─────────────────────────────
                                                       │
                                                       ▼
                                                   PROJECTOR
                                                       │
        ┌───────────────┬──────────────┬──────────────┴──────────────┬──────────────┬──────────────┐
        ▼               ▼              ▼                              ▼              ▼              ▼
  UserProfile     SizingProfile  CategoryPreference            BrandPreference   Recipient   ShoppingIntent
                                                                                                  +
                                                                                  TasteTag, HardNegative


                                                 (retrieval at chat time)
                                                 ─────────────────────────────
  user query ──► category-detector ──► context builder (typed-first, canonical-fallback)
                                                       │
                                                       └─► gap-detector ──► <missing_profile_info>
                                                       │
                                                       └─► Claude system prompt
```

---

## 4. The extraction signals

The extractor (`extractor.ts`) emits these signal types. The projector
(`projector.ts`) maps each to one or more typed projections.

| Signal type | Projects to |
|---|---|
| `profile` | `UserProfile` |
| `size`, `fit`, `fit_like`, `fit_dislike` | `SizingProfile` |
| `style_like`, `style_dislike`, `color_like`, `color_dislike`, `product_type_like`, `product_type_dislike` | `CategoryPreference` + `TasteTag` |
| `brand_like`, `brand_dislike` | `BrandPreference` (+ `HardNegative` when hard rule) |
| `budget` | `CategoryPreference.budget*` |
| `gift_recipient` | `Recipient` |
| `shipping`, `constraint` | `UserProfile.{shippingCountry, …}` |
| `hard_negative` | `HardNegative` (+ negative `TasteTag`) |
| `wishlist` / `extraction.activeIntent` | `ShoppingIntent` |

Any observation with `isHardRule=true` is also written to `HardNegative` so
the agent treats it as an absolute rule, not a soft preference.

### Structured attributes

To make projection deterministic, the extractor's system prompt enforces a
**canonical attribute schema** (see `extractor.ts`). Examples:

- profile: `country`, `currency`, `language`, `ageRange`, `genderPresentation`,
  `climate`, `valuePhilosophy`, `decisionStyle`, `riskTolerance`, …
- size/fit: `shoeSizeEU`, `shoeSizeUS`, `topSize`, `bottomWaist`, `bottomInseam`,
  `topPreferredFit`, `bottomPreferredFit`, `ringSize`, …
- style: `style`, `color`, `material`, `fit`, `pattern`, `tasteTags[]`
- brand: `sentiment`, `reasons[]`, `ownsProducts`, `aspirational`
- budget: `budgetMin`, `budgetMax`, `budgetTypical`, `currency`
- recipient: `recipientLabel`, `knownPreferences[]`, `sizes{…}`, `importantDates[]`,
  `favoriteBrands[]`, …
- hard_negative: `scope`, `value`, `reason`

If the LLM emits non-canonical keys, the projector still tries reasonable
fallbacks (`a.shirtSize ?? a.topSize`, etc.), but the canonical schema is the
preferred contract.

---

## 5. The shopping-context block

At every chat turn we build a structured XML block that the model receives in
its system prompt. Structure (see `context.ts`):

```xml
<user_shopping_context>
  <rules>…</rules>
  <detected_query_categories>shoes</detected_query_categories>
  <identity>Name · Country · Currency · Climate · Lifestyle · Value philosophy …</identity>
  <sizing>Tops · Bottoms · Shoes · Sensitivities …</sizing>
  <category_preferences>
    [shoes › sneakers] prefers: clean, white · avoids: chunky · budget: 80-200 USD
  </category_preferences>
  <brand_graph>
    LOVE: Nike (running fit), Adidas
    AVOID: Shein (ethics)
  </brand_graph>
  <active_intents>
    - [high] Finding white sneakers (by 2026-05-25) :: subcategory=sneakers, color=white, budgetMax=150
  </active_intents>
  <hard_rules>
    - NEVER recommend material="nickel" in jewelry (allergy)
    - NEVER recommend brand="Shein" (ethics)
  </hard_rules>
  <taste_graph>
    Loves: minimalist×8, premium-looking×5
    Avoids: chunky×3, cheap-looking×2
  </taste_graph>
  <recipients>
    - wife (Sarah): age 30-39 · likes: elegant, minimal · brands: Aesop · sizes: clothing=S
  </recipients>
  <other_memories>… canonical fallback for things not yet typed …</other_memories>
  <missing_profile_info>
    The user hasn't told you these yet but they would meaningfully improve this recommendation.
    Weave AT MOST 2 of these conversationally — never as a bulleted list.
    1. (shippingCountry) where I'd be shipping to (country)
    2. (shoeSize) your usual shoe size (EU 44? US 10?)
  </missing_profile_info>
</user_shopping_context>
```

Category-aware: only categories *detected in the current query* surface their
category-scoped prefs / brand graph / hard rules / taste tags. Global rules
always surface.

Capped to `SHOPPING_MEMORY_PROMPT_MAX_CHARS` (10k chars ≈ 2.5k tokens).

---

## 6. Memory scoring (recap)

Every observation carries:

```ts
{
  confidence:  0..1   // how sure are we?
  importance:  0..1   // how useful is this for shopping?
  stability:   "temporary" | "medium" | "stable"
  source:      "explicit" | "inferred" | "behavioral" | "purchase" | "product_return_source"
}
```

Heuristics:

- Explicit user statement: confidence 0.95–1.0
- Repeated behavior: 0.7–0.9
- Single click: 0.2–0.4
- Purchase: 0.7–0.95
- Return with reason: 0.9–1.0
- Assistant inference: 0.4–0.7

Projection rule: highest-confidence value wins, ties keep the most recent.
Array fields are unioned (deduped case-insensitive, capped at 32 entries).

Hard rules: any observation with `isHardRule=true` writes to `HardNegative`
regardless of confidence. They are absolute, not weighted.

---

## 7. Privacy & control

The user must always be able to:

1. **See** everything we remember.  &nbsp; — `GET /api/profile` returns the full
   typed shopper state. `GET /api/shopping-memory` returns canonical memories.
2. **Edit** anything.  &nbsp; — `PATCH /api/profile`, `PATCH /api/profile/sizing`,
   recipient/intent/hard-negative/brand-preference CRUD endpoints.
3. **Delete** specific items.  &nbsp; — `DELETE` on each `/api/profile/*/[id]`.
4. **Wipe** everything.  &nbsp; — `POST /api/shopping-memory/clear` wipes all
   typed + canonical + raw tables for the user.
5. **Understand why** a recommendation appears. &nbsp; — the agent is instructed
   to surface short "matches your X, avoids your Y" rationales when relevant.

Future: a Settings → Shopping Profile UI that consumes these endpoints.

---

## 8. Just-in-time probe (mode D)

When the current query needs a missing field, the gap detector returns up to
3 high-priority probes:

- shipping country (any shopping turn) — priority 9
- currency — priority 5
- shoe size (when query mentions shoes/sneakers/boots) — priority 10
- top size + fit pref (when query mentions shirt/hoodie/sweater/etc.) — 8
- bottom size + fit pref (when query mentions pants/jeans/shorts) — 8
- ring size (when query mentions ring/engagement/wedding ring) — 8
- recipient info (when query mentions gift / "for my X" and no recipients on file) — 9
- per-category budget (no budget mentioned and none on file) — 4

The agent is told to weave **at most 2** into its reply, conversationally,
never as a form. It is not asked again once the typed projection fills.

This is what makes the agent feel *alive*, not interview-y.

---

## 9. API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/profile` | Full typed shopper dump |
| PATCH | `/api/profile` | Update identity / lifestyle / value philosophy |
| GET | `/api/profile/sizing` | Get sizing profile |
| PATCH | `/api/profile/sizing` | Update sizing fields |
| GET | `/api/profile/recipients` | List recipients |
| POST | `/api/profile/recipients` | Create / upsert by label |
| PATCH | `/api/profile/recipients/[id]` | Update recipient |
| DELETE | `/api/profile/recipients/[id]` | Delete recipient |
| GET | `/api/profile/intents` | List active intents (`?status=` filter) |
| POST | `/api/profile/intents` | Create intent manually |
| PATCH | `/api/profile/intents/[id]` | Update intent (status, fields) |
| DELETE | `/api/profile/intents/[id]` | Delete intent |
| GET | `/api/profile/hard-negatives` | List hard rules |
| POST | `/api/profile/hard-negatives` | Create / upsert hard rule |
| DELETE | `/api/profile/hard-negatives/[id]` | Remove hard rule |
| GET | `/api/profile/brand-preferences` | List brand graph |
| POST | `/api/profile/brand-preferences` | Create / upsert brand entry |
| PATCH | `/api/profile/brand-preferences/[id]` | Update brand entry |
| DELETE | `/api/profile/brand-preferences/[id]` | Remove brand entry |
| DELETE | `/api/profile/category-preferences/[id]` | Remove a category pref row |
| DELETE | `/api/profile/taste-tags/[id]` | Remove a taste tag |
| GET | `/api/shopping-memory` | Canonical memories + summary |
| DELETE | `/api/shopping-memory/[memoryId]` | Remove a canonical memory |
| POST | `/api/shopping-memory/clear` | Wipe EVERYTHING (raw + canonical + typed) |
| POST | `/api/shopping-memory/interactions` | Log a product interaction |

All endpoints scope to the dev user (`AI_CHAT_DEFAULT_USER_ID`) until auth is
added.

---

## 10. Implementation roadmap

### Phase 1 — Memory foundation &nbsp; ✅ DONE
- `MemoryObservation`, `ShoppingMemory`, `ShoppingProfileSummary`
- Memory extractor + writer + summary refresh
- Background pipeline that doesn't block the chat stream

### Phase 2 — Typed projections &nbsp; ✅ DONE
- `UserProfile`, `SizingProfile`, `CategoryPreference`, `BrandPreference`,
  `Recipient`, `ShoppingIntent`, `TasteTag`, `HardNegative`
- Projector wired after the writer
- Category-aware context builder
- Just-in-time gap probes
- Full CRUD API surface

### Phase 3 — Onboarding intake &nbsp; ⏳ DESIGN ONLY (see §11)
Status: deferred — open product question on form vs chat vs hybrid.

### Phase 4 — Product picks (visual elicitation) &nbsp; ⏳ DESIGN ONLY (see §12)
Status: deferred — folding into agentic checkout work.

### Phase 5 — Behavioral learning loop &nbsp; ⏳ NEXT
Promote repeated `ProductInteraction` patterns into typed projections /
canonical memories.

### Phase 6 — Personalization ranking &nbsp; ⏳ LATER
Per-product score using `TasteTag` + `BrandPreference` + `HardNegative` +
sizing match + budget match. Returns reasons & warnings per pick. Pairs with
the agentic checkout work.

### Phase 7 — Recipient automation &nbsp; ⏳ LATER
Auto-age recipients by birth year; surface upcoming `importantDates` as
nudges; gift-history learning loop.

---

## 11. Onboarding intake — DESIGN (deferred)

**Goal**: capture the 12 highest-leverage fields with the lowest friction on
first session, without it feeling like a form.

**Highest-leverage fields, in priority order:**
1. Country + currency + language
2. Gender presentation (for category routing)
3. Shoe size
4. Top + bottom sizes + fit preference
5. Climate / city
6. Budget philosophy per category
7. 2–3 style descriptors (minimalist? old money? gorpcore?)
8. 3 brands they LOVE + 3 they AVOID
9. Hard negatives (allergies, ethical bans, religious bans)
10. Active intent (what they're shopping for right now)
11. Owned high-signal items (luxury bag, premium watch, key fragrances)
12. Top 2 recipients (spouse, kid, parent) with sizes + sentiments

**Three design options to choose between (open product question):**

### Option A — Conversational onboarding (chat-first)
On first chat session, the assistant runs a 4–6 turn mini-interview:

> "Hey — Shoop here. I'll be sharper if I know a few basics first. Just five
> quick ones. What should I call you?"

1. preferred name
2. country + currency
3. category interests + lifestyle (1 question, 2 signals)
4. 1 style descriptor or 2 brand loves
5. anything you'd never want me to recommend (allergies, brands you avoid)

Each turn extracts into the projections via the normal pipeline. Skip-friendly.

✅ Best feel, lowest friction.
✘ Some users want to "fill the form and be done".

### Option B — Settings-screen form
A dedicated `/profile/setup` page with sections. Submit → POST batch to
`/api/profile/*` endpoints.

✅ Best for power users.
✘ Highest friction, lowest completion.

### Option C — Hybrid (recommended)
Chat-first onboarding (Option A) with a "Skip — I'll set this up manually"
escape that opens the settings UI. Settings UI is always available later.

**Capture envelope**:

```ts
type OnboardingState = {
  userId: string;
  status: "not_started" | "in_progress" | "skipped" | "completed";
  asked: Record<string, string>; // field → ISO timestamp asked
  startedAt?: Date;
  completedAt?: Date;
};
```

Stored on `UserProfile` as a `JSON onboarding` field (or its own row).

**Implementation sketch (when we build it):**
- New `src/lib/ai-chat/shopping-memory/onboarding.ts` with a state machine.
- New `<onboarding>` block in the system prompt that the model uses ONLY on
  early turns of a new user. Disabled once `onboarding.status === "completed"`
  or after N turns to avoid repeating.
- Reuse the existing extractor + projector — no new write path needed.

---

## 12. Product picks (visual elicitation) — DESIGN (deferred)

**Goal**: extract aesthetic / taste signals without making the user articulate
them in words. Show 2–3 product images and ask "which is more you?". Each pick
emits structured `style_like` / `style_dislike` / `color_like` observations
that flow through the normal pipeline.

Why deferred: the user wants this folded into the agentic checkout
integration so the picks are sourced from real products in the catalog rather
than stock imagery. The architecture below assumes that catalog exists.

**Mechanics:**

```ts
type StylePickPair = {
  id: string;
  category: string;          // "shoes", "fashion", "perfume", …
  axis: "style" | "color" | "material" | "fit" | "pattern";
  options: Array<{
    productId: string;       // from agentic checkout catalog
    image: string;
    label?: string;
    tags: string[];          // ["minimalist", "white", "clean"] — what a pick "means"
  }>;
};

type StylePickResponse = {
  pairId: string;
  pickedProductId: string;
  dismissedProductIds: string[];
  ts: Date;
};
```

When the user picks:
- For the picked option: emit one `style_like` (or appropriate sub-signal)
  per tag, scope=`category`, attributes include the tag list.
- For the dismissed option(s): emit one `style_dislike` per distinguishing
  tag.

Confidence: 0.6 (single pick is weaker than an explicit statement). After
N pairs in the same axis the confidence ramps up to 0.85 for the dominant tag.

UI surfaces:
- Embedded in chat after the first 1–2 messages ("Tell me your style faster —
  pick the one that's more you.")
- Optional standalone `/profile/taste` page

This stays a *projection input* — same writer, same projector — so the rest
of the architecture is unchanged when we ship it.

**Other Mode-C inputs we already collect (no UI needed):**
- `ProductInteraction.action="dismissed"` rows over time → negative taste tags
- `ProductInteraction.action="saved"` + `purchased"` → positive taste tags
- Returns + reasons → strong negative

The learning loop in Phase 5 will mine these into typed projections.

---

## 13. The final rule

> Save every shopping-relevant signal as evidence.
> Promote only reliable, useful signals into canonical memory.
> Project canonical memory into typed tables the agent and UI can use cheaply.
> Retrieve only what's relevant to the current query.
> Ask one missing thing at a time when it would meaningfully improve the answer.
> Never ask the same thing twice.

That's how a real personal shopper feels.
That's how Shoop feels.
