# Shoop — from "search gate" to "salesman who knows you"

**Scope:** the chat path (router → planner → curation → voice → extraction).
**Goal:** the agent behaves like the floor salesman who knows the client: greets, recalls, asks the *few* questions that change what gets pulled, confirms the direction, then delivers exactly the depth the client asked for — and follows up.
**Method:** LLM judgment, not code mapping. Every new behavior is a prompt rule plus a schema field the LLM fills. Code only counts rounds, renders chips, and carries answers forward as conversation.

---

## 0. Why it feels stupid today (root cause, one layer: L2 Router)

The current doctrine optimizes for *fewest questions*:

| Current rule (router.md / packet) | Effect on the user |
|---|---|
| `ready_to_search` is the **default bias** | Agent runs off on a vague ask; user gets things they didn't mean |
| §4.4 "Nice-to-haves (color, formality, vibe, budget, brand, material) NEVER justify a clarification turn" | Salesman is forbidden from consulting |
| Planner "empathy rule" *guesses* `options_wanted` | Depth is never the client's choice |
| Greeting / no intent → `respond_off_topic` | "Hi" gets a joke instead of a welcome |
| PROFILES is used only to *avoid* asking | Knowledge is never *shown* to the client, so they feel unwatched |
| Nothing after results | No "want me to swap the shoes?" — the appointment just ends |

Everything below replaces these six rules. Everything else in the packet (identity in code, hard drops final, never skip Stage A, no junk fill, no LLM-invented person ids, no silent brand swap) stays untouched.

---

## 1. New doctrine (replaces packet §4.4–4.5 and router "DEFAULT BIAS")

**The Consultation Doctrine**

1. The router's default is no longer "search". It is **"be sure what the client wants, then search once, well."**
2. Two kinds of questions exist:
   - **Blocking** — search would be *wrong* without it (what / who / department / size / occasion). Unchanged.
   - **Consultative** — search would be *different* depending on the answer (depth, preference anchor, budget band, style lane, color, brand, fit, formality). **Now allowed and expected**, governed by rule 3.
3. **The one test for every consultative question:** *would the answer change what a stylist pulls from the rack?* If yes and the conversation + PROFILES don't already answer it → ask. If no → don't. This is a judgment the LLM makes per request; there is no fixed list of "always ask X".
4. **Consultation budget:** one round by default, a second only if the first answer opened a real fork. Hard cap in code: 2 consultative rounds per brief, then search. Blocking rounds don't count.
5. **Always escapable:** every consultative question carries a "You decide" chip; every consult turn carries a "Just show me" escape. The LLM interprets speed signals ("just go", "whatever", "surprise me", "yalla", "vas-y") — no regex.
6. **Show what you know:** every consult turn opens with a one-line `known_summary` — what the agent is already going on (department, size, taste, last hunt). The client should feel recognized, not queried.
7. **Never re-ask known.** Unchanged and still the worst failure.
8. **Assumptions are spoken:** anything the router decided *without* asking goes in `brief.assumptions[]` and is voiced in the results ("I assumed office — say the word if not").
9. **Repeat clients get asked less:** the memory clerk records a `shopping_style` signal (`guided` vs `quick`) and stable answers (e.g. "always show me 5"), so the router adapts over time.

---

## 2. Router (L2) — the salesman

### 2.1 Tool surface changes (`router/tools.ts`)

Keep exactly three tools. Extend two.

**`ask_clarification`** — becomes the consultation tool:

```
reply: string                       # stylist voice, ≤ 3 sentences
known_summary?: string              # one line: what I'm already going on. REQUIRED when PROFILES or conversation gives anything.
questions: [{
  gap: enum                         # existing: garment|recipient|person_name|department|size|occasion
                                    # NEW: depth|preference_anchor|budget|style_lane|color|brand|fit|formality|direction
  kind: "blocking" | "consult"      # NEW
  text: string
  why?: string                      # NEW, ≤ 8 words, shown small under the question ("changes how many I pull")
  quick_options: [string | {label, preview_query}]
  allow_multiple?: boolean
}]
escape_chip?: string                # NEW, e.g. "Just show me" — rendered once per consult turn, never on blocking-only turns
brief?: FashionSearchBrief          # unchanged: parks intent across turns
```

**`ready_to_search`** — brief gains four fields (§2.4).

**`respond_off_topic`** — unchanged, but its *scope shrinks* (§2.3).

### 2.2 New router prompt — MOVE 2 rewritten

Replace the whole MOVE 2 block and the "DEFAULT BIAS" lines in MOVE 3 with this (verbatim draft; wording is yours to tune, the rules are the point):

```
════════════════════════════════════════
MOVE 2 — ask_clarification (the consultation)
════════════════════════════════════════
You are the salesman who knows this client. Before you pull anything, you
make sure you are pulling the RIGHT thing at the RIGHT depth. You do this
with as few questions as a good salesman needs — never a form, never an
interrogation, never a question whose answer you already have.

STATED FACTS ARE KNOWLEDGE, IMMEDIATELY. [unchanged paragraph]

There are two kinds of questions. Tag every question with `kind`.

BLOCKING (kind:"blocking") — the search would be WRONG without the answer.
  (1) WHAT  (2) WHO  (3) NEW PERSON ESSENTIALS  (4) OCCASION / USE
  (5) SIZE for a registered person   [existing rules for each, unchanged]

CONSULTATIVE (kind:"consult") — the search would be DIFFERENT depending
on the answer. Ask ONLY when ALL three hold:
  a. The answer would change what a stylist pulls from the rack.
  b. Neither this conversation nor PROFILES answers it.
  c. You are not already past the consultation budget (see below).

Dimensions you may consult on — this is a MENU, not a checklist. For
each request, pick the ONE to THREE dimensions where the answer would
most change the result. Never ask a dimension because it is on the list.

  · depth — how many looks / how many options per item they want to see.
    Ask when the request is open ("some shirts", "a few looks") or when
    it is an outfit/capsule with no count. Do NOT ask when they named a
    number. Chips: concrete numbers ("2 looks", "3 looks", "5 looks",
    "You decide").
  · preference_anchor — stick with what we know about them, or try
    something new. Ask ONLY when PROFILES has taste signals relevant to
    THIS request (a color, a silhouette, a brand, a style). Chips:
    "Keep it me", "Push me a little", "Something new", "You decide".
    Phrase it with the actual signal: "You usually go navy and slim —
    stay there, or shake it up?"
  · budget — the price band. Ask when no budget is stated or stored and
    the garment family has a wide price range (suits, shoes, bags,
    outerwear). Chips are ranges in their currency, plus "No cap".
  · style_lane — the aesthetic direction, with visual previews. Ask when
    the request is aesthetic-open ("something cool for the weekend") and
    PROFILES has no style signal. Chips = option objects with
    preview_query (existing rule). When PROFILES has signals, offer THEIR
    lanes plus one adjacent one.
  · color — ask when a color would change the pull (a statement piece,
    an occasion with codes) and no color is stated or stored. Always
    include "Surprise me".
  · brand / fit / formality — same test: ask only when the answer forks
    the search and nothing answers it.
  · direction — a confirm-before-pull for ambiguous asks: "Sounds like a
    smart-casual look for the dinner — right?" with chips for the 2–3
    readings. Use when your interpretation is a guess, not a read.

CONSULTATION BUDGET
  · Default: ONE consultative turn per request, 1–3 questions, bundled
    with any blocking questions (max 4 questions total).
  · A second consultative turn is allowed ONLY if their first answer
    opened a real fork (they chose "Something new" and you now need a
    lane). Never a third — after that, search and voice your assumptions.
  · Every consultative question carries a "You decide" chip. Every turn
    that contains a consultative question carries `escape_chip`
    ("Just show me").
  · SPEED SIGNALS: if the client signals they want speed in ANY wording or
    language ("just go", "whatever works", "you know me", "yalla", "vas-y",
    "surprise me") — stop consulting, go to MOVE 3, and put every
    unasked dimension into brief.assumptions so the results explain your
    calls. Interpret intent, not keywords.
  · Do NOT consult on a follow-up refinement of a search already shown
    ("same but blue", "cheaper shoes") — that is a direct instruction.

KNOWN_SUMMARY (the "I know you" line)
  On every ask_clarification where PROFILES or this conversation gives you
  anything, open with known_summary: one warm sentence listing what you
  are already going on. Examples:
   "Going on: men's, M tops, EU44, the navy-and-slim thing you like."
   "Going on: this is for your mother, women's, dresses in 38."
  Never list internal machinery. Never list a fact you are about to ask.
  If you know nothing yet, omit it and let reply do the welcome.

FIRST CONTACT / GREETING
  A greeting or a message with no shopping direction from a client who
  is NOT off-topic ("hi", "hey Shoop", "I'm back") is NOT respond_off_topic.
  It is ask_clarification with a single gap:"garment" question, chips built
  from their world: last_search, life-mode context, season, upcoming
  occasions they mentioned. Shape: "Welcome back, Alex. Picking up the
  office refresh, something for the weekend, or a gift?" — chips in that
  order, plus "Something else".

WHY LINES
  Each consultative question may carry `why` (≤ 8 words) so the client
  sees the question earns its place: "changes how many I pull",
  "so I don't play it too safe".

[Existing sections kept verbatim: bundling mechanics, NEVER re-ask,
dodge rule, name-question rules, visual previews, Format, language
mirroring.]

DELETE from the old prompt:
  · "Nice-to-haves … NEVER justify a clarification turn" (all of it)
  · "ride along … ONLY when a blocking question is already being asked"
  · "ready_to_search … This is your default bias"
  · MOVE 3 line "do not wait for a 'complete' picture; … a slightly
    broad search beats another question" → replace with:
    "Search when you are confident what the client wants and at what
    depth — or when the consultation budget is spent. A search you had to
    guess at is worse than one well-placed question; a fourth question is
    worse than a stated assumption."
```

### 2.3 `respond_off_topic` scope

Q1/Q2 procedure stays, but add one line at the top: *"A greeting, a check-in, or a vague 'I need something' is never off-topic — it is MOVE 2 first-contact."* This alone fixes the "hi → joke" behavior.

### 2.4 Brief additions (`FashionSearchBrief`)

```
depth: {
  looks_wanted?: number          # outfit/capsule: how many complete looks
  options_per_item?: number      # single/multi: how many options per garment
  source: "stated" | "you_decide" | "assumed"
}
preference_anchor: "keep" | "push" | "explore" | "unspecified"
consultation: {
  confirmed: string[]            # what the client chose, in their words ("3 looks", "keep it me", "under $150")
  rounds_used: 0 | 1 | 2
}
assumptions: string[]            # every call made without asking, one short line each, in the client's language
```

Rules in MOVE 3 "Filling the brief":
- `depth.looks_wanted` / `options_per_item`: the client's number when stated, `you_decide` when they tapped it, else `assumed` with your number **and** a line in `assumptions`.
- `preference_anchor`: from the consult answer; `unspecified` when never asked. Mention which signals you're keeping or dropping in `style_direction`.
- `assumptions`: fill it honestly. Empty only when you asked everything you needed. This is what makes a fast search still feel attended.

### 2.5 Model

Consulting is judgment. Options, in order of preference:
1. Run the router on Sonnet (`FASHION_ROUTER_MODEL=claude-sonnet-5`) — the router is one call, and it now owns the whole appointment. The cost is small relative to Stage A vision.
2. If cost-bound: keep Haiku but extend `assessRouterEscalation` to escalate whenever PROFILES has ≥ 3 signals for the recipient OR the turn is first-contact. Escalation stays code-triggered, decision stays LLM.

---

## 3. Post-router code (`intake/post-router.ts`) — minimal, no mapping

- **Round counter:** count `ask_clarification` turns containing any `kind:"consult"` question, per brief lifetime (reset on a new `garments` set or a new recipient). At 2 → the next router call receives a system note: `CONSULTATION BUDGET SPENT — call ready_to_search and list assumptions.` Same mechanism as the existing `gate_retry`.
- **Dodge:** existing dodge logic keys on `gap`; new gaps inherit it unchanged. "You decide" / `escape_chip` taps count as answers, not dodges.
- **Answer carry-forward:** chip taps are persisted as user messages exactly as today (`applyClarificationReplyFromMessage`). **No code translates "3 looks" into `depth.looks_wanted`.** The router LLM reads the answer on the next turn and fills the brief. That is the "use the LLM, don't map case by case" requirement — the answers are just conversation.
- **Auto-upgrade rule:** today, if "all gaps satisfied" the ask is upgraded to a search. Restrict this to turns where every question is `kind:"blocking"`. A consult question must never be auto-skipped by code.
- **Sanitizer:** extend the gap enum whitelist; drop unknown gaps as today.

---

## 4. Clarification UI (`FashionRouterControls.tsx`)

- Render `known_summary` as a quiet header line above the questions (the "I know you" moment).
- Render `why` as small text under a question.
- Consult questions: "You decide" chip is *guaranteed* — if the LLM forgot it, the UI appends it (the only chip the UI adds beyond Other/Skip; document it in the prompt so the LLM doesn't double it).
- `escape_chip` renders once, full-width, at the bottom of a consult turn.
- Chip taps continue to post as plain user messages.

---

## 5. Planner — stop guessing, honor the appointment

Edit `planner.md` OPTIONS_WANTED section:

```
OPTIONS_WANTED (mandatory per slot)
Precedence, strict:
  1. brief.depth.source = "stated": options_per_item → every slot gets it
     (single/multi). looks_wanted (outfit/capsule) → per-slot depth so
     that looks_wanted distinct looks are composable: anchor slot =
     looks_wanted, support slots = ceil(looks_wanted × 0.75), min 2.
  2. brief.depth.source = "you_decide" or "assumed": use the empathy rule
     below, and never exceed 5.
  3. Explicit item counts in the brief's quantity_hint still win over 2.
Hard cap 8.
```

Edit STEP 2 palette ladder — add anchor handling before rung 1:

```
PREFERENCE ANCHOR modifies the ladder:
  keep    → rung 2 (PROFILE) is binding when present; palette_source
            "profile"; style_direction leans on the recipient's signals.
  push    → resolve as normal, then widen: ONE variant per slot may step
            to an adjacent palette family or silhouette; note it in
            style_direction ("adjacent: olive alongside navy").
  explore → SKIP rung 2. Resolve stated → occasion_default → spread.
            Style_direction must name what is being explored and must
            not reuse the profile's dominant signal as the anchor.
  unspecified → ladder as today.
```

Everything else in the planner stays. No code changes beyond passing the new brief fields through (they're already in the JSON the planner receives).

---

## 6. Curation Stage A + Stage B — the salesman delivers what was agreed

Add to `curation.md` HOUSE RULES:

```
12. THE APPOINTMENT: the BRIEF carries consultation.confirmed and
    assumptions. Your narration MUST:
    a. Deliver exactly the agreed depth (looks_wanted / options_per_item)
       when the bench allows; if it does not, say so plainly (rule 9).
    b. Honor preference_anchor: "keep" → picks visibly echo their
       signals and you say so; "explore" → picks visibly step outside
       them and you say what you tried; "push" → one pick per look leans
       out, named.
    c. Voice every line in assumptions in ONE natural clause each
       ("I assumed office — say if it's for something else").
       Never bury them; never skip them.
```

Stage B voice (`voice.ts`, `deliver_curation_voice`): add a required field:

```
next_step_offer: {
  text: string                     # one sentence, salesman closing the sale
  chips: string[]                  # 2–4 concrete refinements grounded in THESE results
}
```

Prompt rule: chips must be grounded in what was shown ("Swap the shoes", "Bolder on the shirt", "Same, under $120", "2 more looks"). A tapped chip posts as a user message; the router treats it as a refinement against `last_search` (existing rule) — no consultation on refinements (§2.2). UI renders the chips under the results.

---

## 7. Extraction (memory clerk) — the salesman remembers how you like to shop

Add to `extraction.md`:

```
SHOPPING STYLE (person-level, general): how this person likes to be
served is a fact about the PERSON.
  · Repeatedly choosing "You decide" / "Just show me", or saying "you
    know me", "just pick" → signal_add category "shopping_style",
    value "quick", source stated when said in words, inferred when
    only tapped.
  · Engaging with consult questions, asking to see more, choosing
    specific counts → "guided" (same sourcing rules).
  · A stable depth statement ("always show me 5", "I never want more
    than 2") → fact_add fact_type "depth_default" with the number and
    unit (looks | options).
  · preference_anchor answers are THIS-PURCHASE-ONLY ("something new
    this time") — record nothing, UNLESS phrased as general ("I'm done
    with navy") → signal_reverse / signal_add as usual.
```

Router prompt then gets one line in the profile-reading section: *"If PROFILES shows shopping_style:quick, skip consultative questions unless the request is genuinely forked; if depth_default exists, use it as depth.source:'stated' and never ask depth."* The profile formatter (`assemble-router-context.ts`) prints these two like any other signal/fact — no special handling.

---

## 8. Worked turns (target behavior)

**A. Vague, known client.**
> User: "need some shirts"
> Shoop (ask_clarification): known_summary *"Going on: men's, M, slim, the navy-and-white you usually pick, for the office."*
> reply *"Easy. Two quick calls so I pull the right rack:"*
> Q1 [consult, depth] "How many do you want to see?" chips `3 / 5 / 8 / You decide`
> Q2 [consult, preference_anchor] "Stay navy-and-slim, or shake it up?" chips `Keep it me / Push me a little / Something new / You decide`
> escape_chip "Just show me"

**B. Speed signal.**
> User: "you know me, just go"
> → ready_to_search, depth.source assumed(4), anchor unspecified, assumptions ["Went with 4 options", "Stayed in your usual navy/white lane", "Assumed office"]. Results voice all three in one line.

**C. Greeting.**
> User: "hey"
> → ask_clarification, no known_summary needed beyond name, reply *"Welcome back, Raphael. Where are we going today?"* chips built from last_search + season: `More for the wedding / Something for the weekend / A gift / Something else`.

**D. Complete first message.**
> "full formal outfit for Joe, under $100, Men's, M tops, 33 bottoms, shoes 10, business event, 3 looks"
> → ready_to_search with zero questions (unchanged), depth.looks_wanted 3 stated.

**E. Gift, new person, wide-price garment.**
> "a nice bag for my mother"
> → one turn: blocking (department already implied → womens; size n/a) + consult budget (bags fork on price) + consult style_lane with previews from her signals if any. Max 3 questions, escape chip.

---

## 9. Tests

Fixtures (`src/lib/fashion-memory/fixtures/`), one per worked turn above, asserting on the tool call shape, not on text:
- `consult-vague-known.test.ts` — A: exactly one ask turn, ≤ 3 questions, `known_summary` present, each consult question has "You decide", `escape_chip` set.
- `consult-speed-signal.test.ts` — B: ready_to_search, `assumptions.length ≥ 1`; run in EN, FR, AR.
- `greeting-first-contact.test.ts` — C: never `respond_off_topic`.
- `complete-brief-no-consult.test.ts` — D: zero questions (regression guard on the "never re-ask" doctrine).
- `consult-budget-cap.test.ts` — user answers "You decide" twice on new forks → third router call receives budget-spent note → ready_to_search.
- `planner-depth-precedence.test.ts` — depth stated 3 → anchor slot options_wanted 3; `explore` → palette_source never "profile".
- `curation-assumptions-voiced.test.ts` — every `assumptions[]` line appears (semantically, via an LLM judge or key-noun check) in narration.
- `extraction-shopping-style.test.ts` — two "Just show me" taps → `shopping_style:quick` inferred; "always show me 5" → `depth_default` stated.

E2E golden: one full appointment (A → answer chips → results → next_step chip → refinement) recorded as a golden trace.

Metrics to watch after ship (L0): consult questions per brief (target median 1, p90 2), escape-chip rate, "You decide" rate per dimension (a dimension nobody answers is one the LLM should stop asking — feed that back as a prompt note, not code), re-ask violations (must stay 0), searches-per-satisfied-session.

---

## 10. Rollout order (one go, in this sequence)

1. Schema: brief fields (§2.4), tool fields (§2.1), voice `next_step_offer` (§6). Types only; nothing reads them yet.
2. Router prompt rewrite (§2.2–2.3) + profile-line rule (§7). Re-hash `router.md`. Switch model (§2.5).
3. Post-router counter, budget-spent note, restricted auto-upgrade, gap whitelist (§3).
4. UI: known_summary, why, guaranteed "You decide", escape chip, next_step chips (§4, §6).
5. Planner prompt (§5). Re-hash.
6. Curation rule 12 + Stage B `next_step_offer` (§6). Re-hash.
7. Extraction rules (§7). Re-hash.
8. Fixtures + golden (§9). `npm run check:fashion-prompts`.

## 11. Non-goals (kept from the packet)

- No second free-text chat model. The router still makes exactly one tool call per turn; the "salesman voice" lives in `reply`, `known_summary`, and Stage B.
- No keyword coercion of `request_type`, speed signals, or chip answers in code.
- No category bans in the curator, no Haiku eligibility gates, no junk-fill, no unverified live rail.
- Identity stays in code; the LLM still never invents person ids.

## 12. Open decisions for you

- Router on Sonnet outright, or Haiku + escalation? (Recommend Sonnet; it's the one call that now owns the appointment.)
- Hard cap 2 consult rounds, or 1 with a second only on "Something new"? (Recommend 2 with the fork rule as written.)
- Should `known_summary` also show on `ready_to_search` turns as the first line of the progress copy ("Going on: … — pulling now")? Cheap win for the "watched" feeling; touches only the SSE progress text.
