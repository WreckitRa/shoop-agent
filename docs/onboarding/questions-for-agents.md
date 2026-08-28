# Shoop onboarding — question script (for AI agents)

> **Use this file as the source of truth for what the live wizard asks.**  
> Storage / APIs / fashion-memory projection: [`onboarding-flow.md`](./onboarding-flow.md).  
> Outfit-grid ranking: [`outfit-grid-wear-steal-logic.md`](./outfit-grid-wear-steal-logic.md).  
> Code: `src/components/onboarding/OnboardingGate.tsx`, step components, `src/lib/onboarding/form-options.ts`.

---

## How to use this document

You are simulating, reviewing, extracting, or filling Shoop onboarding. Follow these rules:

1. **Ask only questions that appear below, in this order.** Do not invent country, city, currency, clothing sizes, occupation, compliment chips, or “what’s your world” lifestyle chips — those are **not** on the live wizard.
2. Quote **Prompt** copy to the user. Persist **Value** (the wire token), never the display label.
3. Honor **Select**, **Required**, and **Skip**. Empty answers are valid unless Required says otherwise.
4. Honor **Shown when**. Hidden questions must not be asked.
5. The **Tell-me box** (always-on free text, except verdict) can fill later fields early. Still walk remaining empty steps; do not re-ask facts already captured.
6. `%%word.%%` in titles is a red highlight in UI. When speaking, drop the markers: “The photo doesn’t round down.”
7. Min age is **13**. A birthday that makes the user younger than 13 is a hard stop.

**Wire vs label:** chips store `value`. UI shows `label`. Always store `value`.

---

## Canonical step order

`FITTING_STEPS` in `src/components/onboarding/fitting/types.ts`:

| # | `step` | Screen | Required to leave? |
|---|--------|--------|--------------------|
| 1 | `consent` | Three yeses before a photo | All visible checkboxes |
| 2 | `photo` | Face photograph | No — skip allowed |
| 3 | `name` | Identity print | Name + clothing presentation + ≥1 style era |
| 4 | `life` | Week / dressing / kids / climate | No |
| 5 | `spend` | How you buy | No |
| 6 | `fit` | Height / weight / build / shape | No (defaults apply later) |
| 7 | `worn` | Looks you actually wear | No — max 3 |
| 8 | `wanted` | Looks you’d steal | No — max 2 |
| 9 | `nolist` | Brand loves, comfort lines, vetoes | No |
| 10 | `honesty` | Stylist tone | No |
| 11 | `circle` | Who you ask | No — skip CTA |
| 12 | `verdict` | Scan-check (if photo) then the card | Finish / save |

Server complete still requires `preferredName`, `genderPresentation`, `ageRange` (`ageRange` is derived from birthday or style era — never asked as its own chip).

---

## Global overlay — Tell-me box

Present on every question step except `verdict`. Not a numbered step.

| | |
|--|--|
| **UI** | Input on the fitting card: placeholder `Write anything... I'll fill the form`. Button `Tell me`. |
| **Behavior** | LLM extracts structured fields (`POST /api/onboarding/fitting-tell`) and prefills later steps. |
| **Agent rule** | If the user dumps several answers in one utterance, map them onto the schema below and skip those questions when you reach their steps. |

---

## Step 1 — `consent`

**Title:** Three yeses before a photo.  
**Kick:** BEFORE WE START  
**Whisper:** We measure you from one face photograph. No account yet — save at the end if you want to keep this. Full terms in Biometric Consent.

All visible ticks must be true to continue. CTA: `Continue to photo`.

### Q1.1 Age attestation

| | |
|--|--|
| **Prompt** | I am at least 13 years old. |
| **Select** | single checkbox — must be checked |
| **Value** | `ageAttested: true` |
| **Required** | yes |

### Q1.2 Own-photo attestation

| | |
|--|--|
| **Prompt** | The photograph is of me. I agree to Shoop measuring me from it, as described in the Biometric Consent. |
| **Select** | single checkbox — must be checked |
| **Value** | `ownPhotoAttested: true` |
| **Required** | yes |

### Q1.3 Guest abandon-delete (guests only)

| | |
|--|--|
| **Shown when** | User has no saved account (`guest === true`) |
| **Prompt** | If I leave without saving an account, delete this photograph and the measurements. |
| **Select** | single checkbox — must be checked when shown |
| **Value** | `abandonDeleteAck: true` |
| **Required** | yes when shown |

---

## Step 2 — `photo`

**Kick:** THE SCAN · FACE  
**Title:** The photo doesn’t round down.  
**Whisper (guest):** One face photograph — tap the face on the card. It stays on this device until you save your progress — we don’t process it until then. Height and build are typed facts after this.  
**Whisper (signed in):** One face photograph — tap the face on the card. Height and build are typed facts after this — used for the twin, never shown, never judged.

Height / build are **not** on this step. They are step 6 (`fit`).

### Q2.1 Face photograph

| | |
|--|--|
| **Prompt** | (no field label — tap the face on the card / file picker) |
| **Select** | image file (`accept="image/*"`) |
| **Skip** | `skip... you can add it at the Mirror` (no photo) |
| **If photo set** | `Change photo` + CTA `Keep going... it's developing` |
| **If no photo** | CTA `Skip for now` |
| **Stored** | local preview; coverage is always `"face"` |
| **Required** | no |

Guidance shown: Face the light, just you, no heavy filters. Photos train nothing and are sold to no one; delete anytime.

---

## Step 3 — `name`

**Title:** What do we put on the print?  
**Whisper:** Your name claims it. Everything after develops it... watch the print on the right.

Client will not leave this step without name + clothing presentation + at least one style era. Birthday is optional. Under-13 birthday is a hard error.

### Q3.1 Preferred name

| | |
|--|--|
| **Prompt** | (no label — text field) |
| **Placeholder** | Your name |
| **Select** | free text, ≤120 |
| **Value** | `preferredName` |
| **Required** | **yes** (client + server) |

### Q3.2 Clothing presentation

| | |
|--|--|
| **Prompt** | How do you shop for clothing? |
| **Why** | This just decides which racks open first... you can wander anywhere, anytime. |
| **Select** | single chip |
| **Required** | **yes** (client + server) → `genderPresentation` |

| Value | Label |
|-------|-------|
| `masculine` | Masculine |
| `feminine` | Feminine |
| `androgynous` | Androgynous |
| `nonbinary` | Non-binary |
| `prefer not to say` | Prefer not to say |

Aliases accepted only via Tell-me / intake, not as extra chips: male/man/m → `masculine`; female/woman/f → `feminine`; non-binary/nb → `nonbinary`.

Downstream: `feminine` shows Bust on step 6; outfit decks bucket `masculine` / `feminine` / else `androgynous`. Comfort and brand suggestions gate on masculine vs feminine.

### Q3.3 Birthday

| | |
|--|--|
| **Prompt** | When's your birthday? |
| **Why** | Keeps things legal, maybe unlocks a little something on the day... never shown, never used to box you in. |
| **Select** | date (`YYYY-MM-DD`) **or** chip `Prefer not to say` |
| **Constraints** | max date = today minus 13 years; under-13 → “You need to be at least 13 to use Shoop.” |
| **Skip** | `Prefer not to say` → `birthDateSkipped: true`, `birthDate` cleared |
| **Required** | no |
| **Side effect** | A valid ≥13 date pre-selects a style era and **narrows Q3.4** to ~4–6 nearby eras (`styleErasForAge`). |

Derived `ageRange` (never shown as a question): `13-17` | `18-24` | `25-34` | `35-44` | `45-54` | `55-64` | `65+`.

### Q3.4 Style era

| | |
|--|--|
| **Prompt** | Which era is your style living in? |
| **Hint (no DOB)** | pick one or more... style doesn't check ID |
| **Hint (with DOB)** | birthday narrowed these… pick one or more |
| **Select** | multi chip (toggle) |
| **Required** | **yes** — at least one. Feeds `ageRange` when birthday is skipped. |
| **Stored** | CSV of values on `UserProfile.styleEra` |

Full list (no birthday). With birthday, only a window around the guessed era is shown — do not offer eras outside that window.

| Value | Chip label | Derives `ageRange` |
|-------|------------|-------------------|
| `13_14` | 13–14 Figuring it out | `13-17` |
| `15_17` | 15–17 High-school | `13-17` |
| `18_22` | 18–22 Campus | `18-24` |
| `23_29` | 23–29 First-paycheck | `25-34` |
| `30s` | 30s Prime | `25-34` |
| `40s` | 40s Power | `35-44` |
| `50s_60s` | 50s–60s Refined | `55-64` |
| `65_plus` | 65+ Icon | `65+` |

Multi-select: first recognized era wins for `ageRange`.

---

## Step 4 — `life`

**Title:** What does a week look like?  
**Whisper:** Three taps. This is how I stop handing a student a boardroom look... or a parent a night-out they didn’t ask for.

All four are single-select chips. Tap again to clear. Entire step is skippable (empty → continue with no save).

### Q4.1 Week

| | |
|--|--|
| **Prompt** | Your week is... |
| **Select** | single (toggle off) |
| **Required** | no |
| **Stored** | `weekIs` |

| Value | Label |
|-------|-------|
| `studying` | Studying |
| `working_onsite` | Working on-site |
| `working_home` | Working from home |
| `working_mixed` | Mix of home and office |
| `own_thing` | Doing my own thing |
| `home_with_kids` | Home with kids |
| `between_things` | Between things |
| `retired` | Retired |

### Q4.2 Dressing for

| | |
|--|--|
| **Prompt** | Dressing for... |
| **Why** | Dating, with someone, or not right now... it only changes which nights I dress. |
| **Select** | single (toggle off) |
| **Required** | no |
| **Stored** | `dressingFor` |

| Value | Label |
|-------|-------|
| `dating` | Dating |
| `with_someone` | With someone |
| `not_right_now` | Not right now |

### Q4.3 Kids

| | |
|--|--|
| **Prompt** | Kids? |
| **Select** | single (toggle off) |
| **Required** | no |
| **Stored** | `kids` |

| Value | Label |
|-------|-------|
| `young` | Young kids |
| `older` | Older kids |
| `none` | No kids |

### Q4.4 Climate

| | |
|--|--|
| **Prompt** | Climate where you live |
| **Why** | Fabric weight, and whether a beach day even makes the list. |
| **Select** | single (toggle off) |
| **Required** | no |
| **Stored** | `climate` |

| Value | Label |
|-------|-------|
| `hot_humid` | Hot and humid |
| `hot_dry` | Hot and dry |
| `four_seasons` | Four seasons |
| `mild_wet` | Mild and wet |
| `cold` | Cold |

### Derived (not asked)

`lifestyleTags` from week + kids (`lifestyleTagsFromLife`). Do **not** also ask WORLD_OPTIONS.

| Condition | Adds tag |
|-----------|----------|
| `weekIs = studying` | `campus_life` |
| `weekIs` in `working_onsite` / `working_home` / `working_mixed` | `deep_in_career` |
| `weekIs = own_thing` | `running_the_show` |
| `weekIs = home_with_kids` | `kids_in_the_mix` |
| `weekIs = retired` | `time_is_mine` |
| `kids` is `young` or `older` | `kids_in_the_mix` |

`between_things` adds no tag by itself.

---

## Step 5 — `spend`

**Title:** How do you like to spend?  
**Whisper:** I never rank by cheapest... I find the best match inside how **you** buy. Deals become a bonus, not the sort order.

### Q5.1 Spend philosophy

| | |
|--|--|
| **Select** | multi chip + optional custom |
| **Required** | no |
| **Stored** | `valuePhilosophy` CSV of values; custom entries as `custom:<label>` |
| **Custom** | `+ your own... type + enter` |

| Value | Label | Hint (not on chip; for agents) |
|-------|-------|--------------------------------|
| `best_value` | Smart value | Quality without overspending |
| `premium` | Quality first | Invest in pieces that last |
| `luxury` | Luxury & designer | Top-tier brands welcome |
| `deal_hunter` | Deal hunter | Sales and value drive me |
| `design_first` | Design-led | Aesthetics over price |

---

## Step 6 — `fit`

**Title:** A few numbers.  
**Whisper:** Height, build, the honest bits. Used for the twin — never shown, never judged.  
**CTA:** `Lock it in`  
All optional. Unset build later defaults to `average`; unset definition is inferred from build.

### Q6.1 Height

| | |
|--|--|
| **Prompt** | How tall are you? |
| **Why** | type it... and watch the card, the figure grows with you |
| **Select** | number + unit toggle |
| **Units** | `ft / in` or `cm` |
| **Ranges** | ft 4–7, in 0–11; cm 140–210 |
| **Default UI** | 175 cm / 5 ft band if untouched |
| **Required** | no |

### Q6.2 Weight

| | |
|--|--|
| **Prompt** | And your weight? |
| **Hint** | helps the fit math... never shown, never judged |
| **Select** | number + unit **or** `Prefer not to say` |
| **Units** | `lb` or `kg` |
| **Range** | 35–250 in the active unit |
| **Skip** | `Prefer not to say` → `weightSkipped: true`, value null |
| **Required** | no |

### Q6.3 Build

| | |
|--|--|
| **Prompt** | Your build |
| **Hint** | honesty beats flattery... true fit is the whole point |
| **Select** | single chip |
| **Required** | no |
| **Stored** | `build` |

| Value | Label |
|-------|-------|
| `slim` | Slim |
| `average` | Average |
| `athletic` | Athletic |
| `broad` | Broad |
| `plus` | Plus |

### Q6.4 Definition (muscularity)

| | |
|--|--|
| **Prompt** | Definition |
| **Hint** | Used to shape your twin — soft, toned, or defined |
| **Select** | single chip; tap again to clear |
| **Required** | no |
| **Stored** | `muscularity` |

| Value | Label | Hint |
|-------|-------|------|
| `low` | Soft | Relaxed, natural |
| `moderate` | Toned | Light definition |
| `high` | Defined | Visible shape |

If skipped: `slim` → `low`, `athletic` → `high`, else `moderate`.

### Q6.5 Shape

| | |
|--|--|
| **Prompt** | Shape |
| **Hint** | where weight sits — shoulders, hips, middle. Skip if unsure. |
| **Select** | single chip; tap again to clear |
| **Required** | no |
| **Stored** | `bodyShape` |

| Value | Label |
|-------|-------|
| `rectangle` | Rectangle |
| `triangle` | Triangle |
| `inverted_triangle` | Inverted |
| `hourglass` | Hourglass |
| `oval` | Oval |

### Q6.6 Bust

| | |
|--|--|
| **Shown when** | `genderPresentation === feminine` |
| **Prompt** | Bust |
| **Hint** | visual only — for the twin, never cup sizes |
| **Select** | single chip; tap again to clear |
| **Required** | no |
| **Stored** | `bustFullness` |

| Value | Label |
|-------|-------|
| `subtle` | Subtle |
| `average` | Average |
| `full` | Full |
| `very_full` | Very full |

### Q6.7 Legs

| | |
|--|--|
| **Prompt** | Legs |
| **Hint** | where the vertical splits — rise vs inseam |
| **Select** | single chip; tap again to clear |
| **Required** | no |
| **Stored** | `legLine` |

| Value | Label | Hint |
|-------|-------|------|
| `long_torso` | Long torso | Rise sits higher |
| `even` | Even | Split at mid |
| `long_leg` | Long legs | Inseam does the work |

---

## Step 7 — `worn`

**Title:** Which three did you actually wear most?  
**Whisper:** No judgment... this is a safe space for that hoodie. Your picks are voting on the print.  
**Why:** Your real wardrobe is my starting point. The dream comes next.

### Q7.1 Worn looks

| | |
|--|--|
| **Select** | visual cards, max **3** |
| **Required** | no — continue with zero |
| **Over max** | “Remove one to swap — max 3.” |
| **Pagination** | `See more styles` (9 per page) |
| **Stored** | TasteTag category `worn` (label + tasteTags + archetype) |

Cards are **not** a fixed chip list. They are ranked from the in-house catalog (`outfit-style-catalog.ts`) by gender bucket, era, lifestyle, spend. Same catalog feeds wanted (step 8); worn picks are hard-excluded there.

Archetype cells (casting matrix): Parisian, Minimal, Romantic, Street, Classic, Sporty, Boho, Bold, Wildcard.

Catalog labels an agent may see (filtered — never dump the whole list to the user):

**Feminine (and some androgynous):** trench + café knit; black column day; soft blouse + midi; denim + white sneaks; blazer + trousers; knit + easy joggers; linen shirt set; leather + graphic tee; hoodie + leggings truth; quiet-luxury airport; gallery black column; garden party dress; street-sharp night; tailored suit day; clean matching set; festival layers; sequin evening hit; architect coat moment; campus denim basics; refined cashmere day; easy earth layers; color-block statement; monochrome layers.

**Masculine (and some androgynous):** trench + knit polo; black tee + clean pants; soft oxford + chinos; denim on denim; blazer + chinos day; hoodie + joggers; linen shirt + shorts; statement jacket + tee; hoodie + jeans truth; quiet-luxury travel; gallery black kit; soft evening shirt; street-sharp night; tailored suit day; clean athleisure set; coastal linen set; black-tie adjacent; architect coat moment; campus tee + jeans; refined navy jacket; boxy denim layers; monochrome layers; track pants + knit; sharp tailoring cut.

`prefer not to say` / `nonbinary` / `androgynous` → androgynous bucket (crossover looks).

---

## Step 8 — `wanted`

**Title:** Whose closet would you steal?  
**Whisper:** Pick two. Where you’re headed matters as much as where you are... I dress both.  
**Why:** Where you're headed matters as much as where you are. I dress both.

### Q8.1 Aspirational looks

| | |
|--|--|
| **Select** | visual cards, max **2** |
| **Required** | no |
| **Over max** | “Remove one to swap — max 2.” |
| **Pagination** | `See more styles` |
| **Stored** | TasteTag category `aspirational` |
| **Constraint** | looks already picked on worn are excluded |

Same catalog and filtering as Q7.1.

---

## Step 9 — `nolist`

**Title:** Quick vetoes and loyalties.  
**Whisper:** The no-list is sacred... whatever lands here, you’ll never see me suggest it. And it prints in red.

Suggested chips are ranked from earlier answers (gender is a **hard gate**, not a score). User can add custom on every row. All optional.

Liking a brand removes it from avoids (and vice versa). Cannot avoid a brand that is currently liked.

### Q9.1 Brands you reach for

| | |
|--|--|
| **Prompt** | Brands you reach for |
| **Hint** | suggested from how you shop and what you picked earlier |
| **Select** | multi + `+ add a brand` |
| **Required** | no |
| **Stored** | `BrandPreference` sentiment `love` |
| **Suggest up to 8** from pool (audience-gated): COS, Uniqlo, Everlane, Arket, Sézane (f), Reformation (f), Aritzia (f), Zara, & Other Stories (f), Massimo Dutti, Theory, Lululemon, Nike, Adidas, New Balance, Levi's, Patagonia, Ralph Lauren, J.Crew, Banana Republic, Todd Snyder (m), Buck Mason (m), Asket (m), Ami (m), APC, Toteme (f), The Row, Loro Piana, Gucci, Prada, Mango (f), H&M, Madewell (f), Quince, Suistudio (f), Me+Em (f), Brunello Cucinelli, Stone Island (m). |

`(f)` = `audience: feminine` only. `(m)` = `audience: masculine` only. Unmarked = any presentation.

### Q9.2 Comfort lines

| | |
|--|--|
| **Prompt** | Comfort lines I won't cross |
| **Hint** | hard filters... I never score my way around these |
| **Select** | multi + `+ your own` |
| **Required** | no |
| **Stored** | comfort constraints (hard filters, not taste scores) |

Shown set is ranked; **audience-gated options are omitted** for the other presentation. Custom free text always allowed.

| Value (store this) | Label | Audience |
|--------------------|-------|----------|
| `no heels` | No heels | feminine |
| `nothing sleeveless` | Nothing sleeveless | feminine |
| `nothing short` | Nothing short | feminine |
| `no tight fits` | No tight fits | any |
| `covered shoulders` | Covered shoulders | feminine |
| `nothing sheer` | Nothing sheer | feminine |
| `no low rise` | No low rise | any |
| `no skinny jeans` | No skinny jeans | masculine |
| `no shorts` | No shorts | masculine |
| `no sandals` | No sandals | masculine |

### Q9.3 Style vetoes

| | |
|--|--|
| **Prompt** | Never put me in... |
| **Hint** | suggested from your looks and spend style... edit freely, or type your own |
| **Select** | multi + `+ your own` |
| **Required** | no |
| **Stored** | `HardNegative` scope `style`, reason `taste` |
| **Suggest up to 8** from: loud logos; neon; distressed; chunky sneakers; fast fashion; overly trendy pieces; see-through fabrics (f); super cropped cuts (f); heavy distressing; costume-y prints; stiff formalwear; office-only looks; ultra-baggy fits; skin-tight everything; synthetic sheen; logo belts; party sequins day-to-day (f); tech-fabric everywhere; drop-crotch (m); graphic-heavy tees (m). |

### Q9.4 Brands you avoid

| | |
|--|--|
| **Prompt** | Brands you avoid |
| **Select** | multi + `+ add a brand` |
| **Required** | no |
| **Stored** | `BrandPreference` sentiment `avoid` |
| **Suggest up to 6** from: Shein; Fashion Nova (f); Supreme; Balenciaga; H&M; Forever 21 (f); Guess; Ed Hardy. Liked brands are stripped from this list. |

---

## Step 10 — `honesty`

**Title:** How honest do you want me?  
**Whisper:** I’ll never say a piece works when it doesn’t. This only sets how I break the news... and every no comes with a yes that gets you the same look.  
**CTA:** `Lock it in`

### Q10.1 Honesty tone

| | |
|--|--|
| **Select** | single tile (2 options — there is no “Gentle” chip) |
| **Required** | no |
| **Stored** | `honestyPreference` |

| Value | Label | Quote on the tile |
|-------|-------|-------------------|
| `straight` | Straight with me | Talk to me like a good friend. Nudge me when you need to — if it doesn't work on me, say so... and show me what does. |
| `no_mercy` | No mercy | Full stylist mode. Tell me exactly what works, what doesn't, and why. I can take it. |

Legacy stored `gentle` normalizes to `straight`. Do not offer Gentle as a live option.

---

## Step 11 — `circle`

**Title:** Who do you actually ask?  
**Whisper:** When you’re not sure about something, whose opinion do you take. **First names are enough.** In about ten seconds you’ll have a verdict worth sending to them.  
**Fine print:** Just names for now. Nothing gets sent to anyone until you send it. They vote in one tap, with no signup and nothing to install.

### Q11.1 Trusted circle

| | |
|--|--|
| **Select** | up to **3** first-name text slots, max 40 chars each |
| **Required** | no |
| **Skip CTA** | `I'd rather decide later` (saves empty circle) |
| **Continue CTA** | `Lock it in` |
| **Stored** | `FashionPerson` friend rows |

Placeholders (not values):

1. The one you text first  
2. And the honest one  
3. Third, if there is one  

Sparse slots allowed (e.g. only slot 1 filled).

---

## Step 12 — `verdict`

Not a quiz. Two phases:

### 12a Scan-check (`finale: scan`) — only if a photo exists and biometric consent is on

**Kick:** THE SCAN · CHECK  
**Title:** Does this look right?  
**Whisper:** Face reading plus the numbers you already gave me. The twin on the card is the picture — fix anything that's off here, then lock it.

Confirm / edit (free-text, prefilled from photo analysis — only rows with a value appear):

| Label | Meaning |
|-------|---------|
| Skin tone | visible skin surface tone / depth |
| Undertone | undertone hypothesis |
| Contrast | facial contrast |
| Eyes | eye color |
| Hair | hair color |
| Face | primary face shape |
| Hair length | hair length |
| Facial hair | facial hair style |

Then re-confirm Height, Weight, Build, Definition, Shape (same option sets as step 6).

| CTA | |
|-----|--|
| `That’s me` | save review |
| `Skip for now` | skip to card |

If the photo yielded nothing: title **Not enough from the photo.** Skip to card.

### 12b The card (`finale: card`)

Reveal: stylist verdict, style-mix donut, dressed twin. No new profile questions.

| CTA | |
|-----|--|
| Guest | `Save your progress and log in` |
| Account | meet twin / complete onboarding |
| Optional | share text to clipboard (circle names if chosen) |

---

## Do not ask (live wizard does not collect these)

These exist in schema, old docs, or Tell-me extraction. **They are not screens in `OnboardingGate`.** Do not present them as onboarding questions.

| Topic | Notes |
|-------|--------|
| Country / city / currency | Defaults exist (US / New York / USD) but no You-step UI |
| Top / bottom / shoe size | `SizingProfile` columns exist; not asked here |
| Occupation, work environment, units prefs | Profile columns; not this wizard |
| `WORLD_OPTIONS` lifestyle chips | Campus life, Deep in my career, etc. — **replaced by step 4**. Tags are derived. |
| Compliment chips (Effortless, Polished, Bold, …) | Persist path exists; **no live step** |
| Third honesty tile `gentle` | Removed; only `straight` / `no_mercy` |
| Clothing department beyond Q3.2 | One presentation chip, not menswear/womenswear as a second question |
| Numeric budget / price cap | Spend is philosophy chips, not a dollar amount |
| Full-body photo / coverage other than face | Coverage is locked to `face` |

---

## Quick copy-paste schema (wire tokens only)

```
consent: ageAttested, ownPhotoAttested, abandonDeleteAck?
photo:   image? | skip
name:    preferredName, genderPresentation, birthDate|skipped, styleEras[]
life:    weekIs?, dressingFor?, kids?, climate?
spend:   valuePhilosophy[]  // best_value|premium|luxury|deal_hunter|design_first|custom:*
fit:     height, weight|skipped, build?, muscularity?, bodyShape?, bustFullness?, legLine?
worn:    lookIds[] max 3
wanted:  lookIds[] max 2
nolist:  brandLikes[], comfort[], hardAvoids[], brandAvoids[]
honesty: straight | no_mercy | unset
circle:  [name, name, name] | skip
verdict: confirm photo traits? | skip → complete
```

---

## Source files

| File | Owns |
|------|------|
| `src/components/onboarding/fitting/types.ts` | step order |
| `src/components/onboarding/fitting/FittingConsentStep.tsx` | step 1 |
| `src/components/onboarding/fitting/FittingPhotoStep.tsx` | steps 2 and 6 |
| `src/components/onboarding/YouIdentityStep.tsx` | step 3 |
| `src/components/onboarding/TasteLifeStep.tsx` | step 4 |
| `src/components/onboarding/TasteSpendStep.tsx` | step 5 |
| `src/components/onboarding/TasteOutfitGridStep.tsx` | steps 7–8 |
| `src/components/onboarding/TasteLovesVetoesStep.tsx` | step 9 |
| `src/components/onboarding/TasteHonestyStep.tsx` | step 10 |
| `src/components/onboarding/TasteCircleStep.tsx` | step 11 |
| `src/components/onboarding/fitting/FittingAnalysisReview.tsx` | 12a |
| `src/components/onboarding/fitting/FittingVerdictStep.tsx` | 12b |
| `src/lib/onboarding/form-options.ts` | enums |
| `src/lib/onboarding/loves-vetoes-suggest.ts` | suggestion pools |
| `src/lib/onboarding/outfit-style-catalog.ts` | look labels |
| `src/lib/photo-analysis/review.ts` | scan-check trait labels |
