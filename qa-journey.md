# Shoop QA Journey — follow top to bottom

Tick every checkbox. Do not skip ahead. When something fails: copy `trace_id` from the debug panel → paste into your fail log as `scenario # | trace_id | expected vs got` → run `npm run trace-to-e2e -- <trace_id>` → continue.

**Accounts (already seeded):**

| Who    | Sign in as              | Password         | User id (for reset)                    |
| ------ | ----------------------- | ---------------- | -------------------------------------- |
| Cold   | `qa-cold@shoop.local`   | `ShoopQaRound1!` | `b8103d39-a4f2-4025-9995-c82a743e636a` |
| Self   | `qa-self@shoop.local`   | `ShoopQaRound1!` | `ab563f5c-e85f-4b0b-a601-346bdb6e59c6` |
| Family | `qa-family@shoop.local` | `ShoopQaRound1!` | `4847b83f-6020-4c61-880e-71c14a97b080` |

**After every search turn, always:**

1. Open the bug icon (Agent Debug panel).
2. Click **Copy** next to `trace_id`.
3. Skim the criteria strip (stated_facts, plan, budget, drops, vetoes).
4. Only then decide PASS / FAIL.

---

## STEP 0 — Machine ready (do once)

- [ ] **0.1** In a terminal, from the repo root, run:

  ```bash
  npm run qa:readiness
  ```

  Wait until every line is ✅ and the verdict says **QA-ready**. If ❌, stop here — fix/report that suite first.

- [ ] **0.2** Run:

  ```bash
  npm run qa:seed-accounts
  ```

  Confirm it prints the three emails above and writes `qa-accounts.local.json`.

- [ ] **0.3** Open `.env` and make sure these lines exist (add if missing):

  ```bash
  NEXT_PUBLIC_AGENT_DEBUG=1
  AGENT_DEBUG=1
  VERIFY_TTL_HOURS=0.05
  # QA_USER_IDS=…   ← seed script writes this
  # AI_CHAT_ADMIN_TOKEN=…  ← needed for /admin/fashion
  ```

- [ ] **0.4** Restart the app:

  ```bash
  npm run dev
  ```

  Open `http://localhost:3000` in the browser.

- [ ] **0.5** Keep a notes file open with a Failures table ready:
  ```
  scenario | trace_id | expected | got
  ```

---

## STEP 1 — Start the day-1 timers FIRST (before anything else)

These must age while you work the other blocks.

- [ ] **1.1** Sign out if needed → sign in as **Self** (`qa-self@shoop.local` / `ShoopQaRound1!`).

- [ ] **1.2** Start a **new conversation**.

- [ ] **1.3** Send exactly:

  ```
  white oxford shirt for work
  ```

  Answer any size/department questions so a search completes.

- [ ] **1.4** When picks appear: **do not touch them**. Leave this tab/conversation alone. Write down the conversation URL / message id. This is **T1** (for stale promote later). Note the clock time.

- [ ] **1.5** Write down a note: “T2 = next time I restart `npm run dev` or deploy — use that window for cross-restart.”

---

## STEP 2 — Block 1: Cold start (account Cold)

Rule for this whole block: **reset Cold before every scenario**. LLM scenarios: run **3 times**; pass needs 2/3 or 3/3 (1/3 = FAIL).

### Helper — how to reset Cold

```bash
npm run qa:reset -- --user b8103d39-a4f2-4025-9995-c82a743e636a
```

Then browser: sign in as Cold → **new conversation**.

---

### Scenario 1.1 — Joe replay (×3)

- [ ] Reset Cold (helper above).
- [ ] Sign in as Cold → new chat.
- [ ] Send exactly:
  ```
  looking for a full formal outfit for joe under 100$ Men's. M for tops, 33 for bottoms. Shoes 10. Business event
  ```
- [x] **PASS if:** zero clarification questions; search starts immediately; debug strip shows `stated_facts` for Joe / mens / M·33·10 / $100; plan mode `outfit` with ≥3 slots; queries start with `mens`.
- [ ] **FAIL if:** any clarification; the word “roster”; single-slot plan.
- [ ] Copy `trace_id`. Repeat twice more (reset each time). Tick only if ≥2/3 pass.

### Scenario 1.2 — Cyprus opener (×3)

- [ ] Reset Cold → new chat.
- [ ] Send:
  ```
  My cousin's wedding is next month in Cyprus
  ```
- [x] **PASS if:** treated as shopping; if clarifying, garment/scope is asked first (vibes only second).
- [ ] **FAIL if:** formality/vibe is the only/first question, or two separate clarification turns for one bundle.
- [ ] Repeat ×3. Tick if ≥2/3 pass.

### Scenario 1.3 — Cold self, minimal ask (×3)

- [ ] Reset Cold → new chat.
- [ ] Send:
  ```
  I need a shirt
  ```
- [ ] Answer the one bundled essentials turn (department + top size). Confirm search runs.
- [ ] **Without resetting**, open a **new conversation** (same account). Send:
  ```
  now trousers for the office
  ```
- [ ] **PASS if:** asks ONLY bottoms size (does not re-ask department); ≤4 questions total across both; never asks fit/age/body.
- [ ] Repeat whole 1.3 ×3 (reset at start of each). Tick if ≥2/3 pass.

### Scenario 1.4 — Dodge twice (×3)

- [ ] Reset Cold → new chat → send `I need a shirt` again to trigger size.
- [ ] Answer size with `hmm not sure`.
- [ ] When asked again: `hmm not sure`.
- [ ] **PASS if:** third turn searches anyway; picks show “check sizing”; no third ask.
- [ ] Repeat ×3. Tick if ≥2/3 pass.

### Scenario 1.5 — Machinery probe (×3)

- [ ] Reset Cold → new chat.
- [ ] Send:
  ```
  get something nice for Lina
  ```
- [ ] **PASS if:** warm human clarification (who is Lina / what kind of thing); replies never say roster / profile / “set her up” / “add her as” / intake.
- [ ] Repeat ×3. Tick if ≥2/3 pass.

### Scenario 1.6 — Off-topic bridge (×3)

- [ ] Reset Cold → new chat.
- [ ] Chat 2–3 messages about starting boxing. Do **not** ask to buy.
- [ ] **PASS if:** warm redirect that includes 2–3 shoppable boxing ideas (gloves / training shoes / tees); ≤1 emoji; not the same line if you push again.
- [ ] Repeat ×3. Tick if ≥2/3 pass.

### Scenario 1.7 — Answers echoed as questions (×3)

- [ ] Reset Cold → new chat → trigger a clarification that asks shoe + waist (e.g. after needing trousers/outfit).
- [ ] Reply exactly in this style:
  ```
  shoe size? 43. waist? 32
  ```
- [ ] **PASS if:** values extracted; no re-ask; search uses 43/32.
- [ ] Repeat ×3. Tick if ≥2/3 pass.

### Block 1 mini-sweep

- [ ] Open `/admin/fashion` with your admin token.
- [ ] Confirm no “Pipeline invariant flagged” on the Block 1 runs you just did.
- [ ] Open `/api/health` — page loads; no screamingly broken tripwire.

---

## STEP 3 — Block 2: People & memory

### Scenario 2.1 — Register the cast (Family) — once

- [ ] Sign in as **Family**.
- [ ] New chat. Shop for **my brother Gabriel** (give sizes when asked until search finishes).
- [ ] New chat. Shop for **Joe my colleague** (give sizes until search finishes).
- [ ] **PASS if:** two distinct people; facts land under the right person (debug panel / admin — no blend).

### Scenario 2.2 — Ambiguous “him” (Family)

- [ ] Same Family account, new chat (after 2.1).
- [ ] Send:
  ```
  get him a shirt too
  ```
- [ ] **PASS if:** one-tap options show **both** Gabriel and Joe; picking one searches with that person’s sizes.

### Scenario 2.3 — Mom alias (Family)

- [ ] New chat. Shop once for **my mother Rima** (register her).
- [ ] New conversation. Send:
  ```
  mama needs a scarf for winter
  ```
- [ ] **PASS if:** no second mother person; search uses Rima’s facts.

### Scenario 2.4 — Kids department (Family)

- [ ] New chat. Send:
  ```
  hoodie for my 8 year old son
  ```
- [ ] **PASS if:** boys flow; queries start `boys`; sizes asked kid-appropriately.

### Scenario 2.5 — Request ≠ preference (Self)

- [ ] Sign in as **Self** (do not reset).
- [ ] New chat. Send:
  ```
  I want a black shirt
  ```
  Complete essentials → search.
- [ ] In debug/admin or DB: **PASS if** `request_events` has black and **zero** `style_signals` for black.
- [ ] Same conversation (or next). Send:
  ```
  honestly I basically live in monochrome
  ```
- [ ] **PASS if:** a stated style signal for monochrome appears.

### Scenario 2.6 — Size correction (Self)

- [ ] Still Self. If Self has no tops size yet, first complete a simple shirt search stating size **M**.
- [ ] New chat. Send:
  ```
  actually I'm an L now, I sized up
  ```
- [ ] **PASS if:** no size question; next shirt search uses L (old M superseded, not deleted).

### Scenario 2.7 — MEMORY LOOP (Cold) — most important — ×3

- [ ] Reset Cold.
- [ ] Sign in Cold → new chat. Send:
  ```
  casual shirt for the weekend
  ```
  Complete essentials → when picks show: **reject the darkest** picks; **promote/tap an olive or light** item.
- [ ] New conversation (same Cold account, **no** reset). Send:
  ```
  another shirt, same vibe
  ```
- [ ] **PASS if:** picks lean olive/light; criteria strip shows `palette_source: profile` (or olive-positive signal in plan context).
- [ ] Repeat whole 2.7 ×3 (reset at start). Tick if ≥2/3 pass.

### Block 2 mini-sweep

- [ ] `/admin/fashion` — no unexpected flags on Block 2 traces.
- [ ] Spot-check one Family + one Self trace Overview.

---

## STEP 4 — Block 3: Search quality

Use **Self** for 3.1–3.2 and 3.4–3.6. Use **Family** for 3.3 (Rima must exist — you did that in 2.3).

### 3.1 Department wall (Self) — ×3

- [ ] Self → new chat. Send:
  ```
  formal blazer for work
  ```
- [ ] **PASS if:** zero women’s items in tiers 1–3; queries start `mens`; women boutiques dropped (shop-map evidence in trace).
- [ ] Repeat ×3. Tick if ≥2/3.

### 3.2 Brand present (Self) — ×3

- [ ] Pick a brand you know is on the allowlist. Send e.g.:
  ```
  [brand] t-shirt
  ```
- [ ] **PASS if:** brand items in picks; narration says brand found; `brand_match` in score breakdown.
- [ ] Repeat ×3. Tick if ≥2/3.

### 3.3 Brand absent — Aldo (Family) — ×3

- [ ] Family → new chat. Send:
  ```
  dress for my mother from aldo
  ```
- [ ] **PASS if:** narration **explicitly** says Aldo wasn’t found + same-spirit alternatives (optional footwear sanity note).
- [ ] Immediately repeat the same ask. **PASS if:** second run shows **zero** `brand_translate` LLM calls (cached).
- [ ] **FAIL if:** silent swap to other brands with no Aldo mention.
- [ ] Repeat full 3.3 ×3. Tick if ≥2/3.

### 3.4 Color honesty (Self) — ×3

- [ ] Send:
  ```
  olive green overshirt
  ```
- [ ] **PASS if:** picks look olive; label/photo mismatches carry “photo shows”; stylist lines say the true color.
- [ ] Repeat ×3. Tick if ≥2/3.

### 3.5 Occasion sanity (Self) — once each

- [ ] New chat: `outfit for a beach wedding in August` → note palette/formality.
- [ ] New chat: `outfit for the office` → note palette/formality.
- [ ] New chat: `gym outfit` → note palette/formality.
- [ ] **PASS if:** the three look different; wedding tier-1 has no hoodie-style miss.

### 3.6 Attire integrity (Self)

- [ ] Open any recent blazer or shirt result (or run a fresh blazer search).
- [ ] Inspect all three tiers. **PASS if:** no t-shirts in blazer slots; no dresses in shirt slots; odd tier-2/3 items carry `attire_conflict` if present.

### Block 3 mini-sweep

- [ ] `/admin/fashion` check flags.
- [ ] Copy one fail (if any) via `npm run trace-to-e2e -- <trace_id>`.

---

## STEP 5 — Block 4: Budget (Self only)

Always: Self → new chat → send line → wait for picks → check criteria strip.

### 4.1 Single item

- [ ] Send: `shirt under $50`
- [ ] **PASS if:** tier-1 all ≤ ~$60; no $200+ item in tier-1.

### 4.2 Outfit total

- [ ] Send: `outfit for work, $200 total`
- [ ] **PASS if:** each look’s total ≤ ~$220; totals shown; criteria shows per-slot fractions + `fraction_source`.
- [ ] Keep this `trace_id` for 4.6.

### 4.3 Capsule set

- [ ] Send: `3 work outfits to rotate, $300`
- [ ] **PASS if:** SET total ≤ ~$330 shown; narration says budget covers all pieces; tops roughly $40–90 (not $150+); grid + outfits render.
- [ ] **Keep this conversation open / URL** — needed for 5.10 later.

### 4.4 Impossible budget

- [ ] Send: `full formal outfit under $30`
- [ ] **PASS if:** honest tension line; best-effort shown; no junk parade (socks/laces/baby); tension `tight`/`infeasible` in criteria.

### 4.5 Oversized budget

- [ ] Send: `plain white tee, up to $500`
- [ ] **PASS if:** value note present; picks not luxury-skewed.

### 4.6 Guard band (trace only)

- [ ] Re-open 4.2’s admin trace / debug strip.
- [ ] **PASS if:** priced lanes show guard ≈ 2× enforced; budget drops present where relevant.
- [ ] Open `/api/health` → glance at `priced_lane_junk`.

### Block 4 mini-sweep — flags clean?

- [ ] Yes / note failures.

---

## STEP 6 — Block 5: Picks & interactions (Self)

### 5.0 Setup — one rich search

- [ ] Self → new chat. Send:
  ```
  smart casual outfit, $250
  ```
- [ ] Wait until full picks page is ready. Keep this conversation open for 5.1–5.5 and 5.8.

### 5.1 Tiers render

- [ ] Confirm three tiers: stylist picks / also verified / not yet verified.
- [ ] **PASS if:** no item in two tiers; size badges look right (e.g. converted size provenance).

### 5.2 Reject

- [ ] Reject one tier-1 pick.
- [ ] **PASS if:** replacement appears near-instantly (not a full new search).

### 5.3 Promote

- [ ] Promote one tier-2 item into picks.
- [ ] **PASS if:** it swaps in; demoted returns to tier 2.

### 5.4 Verify (sold-out honest path)

- [ ] In a terminal, set the fault (use the **conversation id** from the URL/chat):
  ```bash
  curl -X POST localhost:3000/api/dev/qa-faults \
    -H 'Content-Type: application/json' \
    -d '{"conversation_id":"<PASTE_CONVERSATION_ID>","faults":[{"name":"kill_next_hydration","n":1}]}'
  ```
- [ ] Click **Verify** on a tier-3 item.
- [ ] **PASS if:** either it joins verified, or you get an honest sold-out-in-your-size line.

### 5.5 Look swap

- [ ] On an outfit look, ask for other trousers for that look.
- [ ] **PASS if:** alternatives fit that look’s anchor; total updates on screen.

### 5.6 Stale promote (uses T1)

- [ ] Go back to the **T1** conversation from Step 1 (`white oxford shirt…`).
- [ ] Wait until TTL passes: with `VERIFY_TTL_HOURS=0.05`, wait **~3 minutes** from T1 time (or 24h if you unset that env).
- [ ] Promote a tier-2 item.
- [ ] **PASS if:** brief re-verify happens; if dead → honest message + next option.

### 5.7 Cross-restart (uses T2)

- [ ] Restart the server (`Ctrl+C`, then `npm run dev`) — this is your T2 window.
- [ ] Sign back in as Self → open an **older** search with picks.
- [ ] Reject a pick.
- [ ] **PASS if:** replacement still works after restart (pool rehydrated).

### 5.8 Show me more

- [ ] On the rich `$250` result (or a fresh outfit search), keep asking for more until it stops.
- [ ] **PASS if:** honest “that’s everything solid” + offer to search fresh; **never** auto re-searches.

### 5.9 Re-curate (forced)

- [ ] Self → **new** chat. Note the conversation id (create chat first / send a short hello if needed).
- [ ] Inject fault:
  ```bash
  curl -X POST localhost:3000/api/dev/qa-faults \
    -H 'Content-Type: application/json' \
    -d '{"conversation_id":"<PASTE_CONVERSATION_ID>","faults":["force_curation_timeout"]}'
  ```
- [ ] Send a normal outfit search, e.g. `smart casual outfit for Friday`.
- [ ] **PASS if:** degradation line in stylist voice (no “fallback/timeout/pipeline”); “another styling pass” works **once**; second attempt politely refused.
- [ ] Criteria strip: `qa_fault_fired` / `degradation_kind: curation_fallback`.

### 5.10 Capsule swap

- [ ] Open the **4.3** capsule result conversation.
- [ ] Swap one bottom.
- [ ] **PASS if:** replacements still pair with remaining tops (grid still coherent).

### Extra — invisible lane failure

- [ ] New chat → set fault `fail_one_lane` → run a search.
- [ ] **PASS if:** user sees **no** degradation banner; criteria `degradation_kind: none`.

### Block 5 mini-sweep

- [ ] Flags / fail log updated.

---

## STEP 7 — Block 6: Language & tone (Cold)

### 6.1 Arabic (×2–3 if you have time)

- [ ] Reset Cold → new chat.
- [ ] Run the 1.3 flow in **Arabic** (`أحتاج قميص` / complete essentials in Arabic).
- [ ] **PASS if:** reply + quick options + stylist lines stay Arabic.

### 6.1b French

- [ ] Reset Cold → new chat.
- [ ] Same flow in **French** (`J'ai besoin d'une chemise`).
- [ ] **PASS if:** UI copy mirrors French.

### 6.2 Tone sweep

- [ ] Skim replies from everything so far. **PASS if:** no user-facing “funnel / fit score / pipeline / slot / fallback / curation”; degraded lines still sound like a stylist; no double-rendered question text.

---

## STEP 8 — Block 7: Isolation (once)

- [ ] Run:
  ```bash
  npm run qa:isolation -- --users b8103d39-a4f2-4025-9995-c82a743e636a,ab563f5c-e85f-4b0b-a601-346bdb6e59c6,4847b83f-6020-4c61-880e-71c14a97b080
  ```
- [ ] **PASS if:** script prints all checks ✅.

- [ ] Sign in as Self → new chat → small search. Confirm roster/context has **no** Gabriel / Joe / Rima from Family.

- [ ] Sign in as Family → repeat Aldo once. Confirm brand translate still cached (no new LLM call) — shared cache is OK.

---

## STEP 9 — Block 8: Final dashboard sweep

- [ ] Open `/admin/fashion` → scan today’s runs → **zero** unexpected “Pipeline invariant flagged” on scenarios you marked PASS.
- [ ] Spot-check 3 traces’ Overview: “known before search” / brief matches what that account knew **then**.
- [ ] Open `/api/health` — curation latency not tripwired; junk share looks sane.
- [ ] Pick one product you expected but didn’t see → open:
  ```
  http://localhost:3000/why?product=<paste URL or GID>
  ```
  **PASS if:** drop reason or score breakdown is coherent.

---

## STEP 10 — Exit

- [ ] Every FAIL row has `trace_id` + you ran `npm run trace-to-e2e -- <trace_id>`.
- [ ] Isolation script green.
- [ ] Final sweep done.
- [ ] Hand the fail list to the next change-request batch.

**You’re done.**
