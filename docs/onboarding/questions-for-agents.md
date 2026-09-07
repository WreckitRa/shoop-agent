# Shoop onboarding — questions, required vs optional, storage

> **Scope:** the live Fitting quiz (`OnboardingGate` + `FITTING_STEPS`) **without** the stylist verdict card and **without** face / photo analysis (scan-check).  
> **Verdict pipeline:** [`verdict-page-pipeline.md`](./verdict-page-pipeline.md).  
> **APIs / projection:** [`onboarding-flow.md`](./onboarding-flow.md).  
> **Code:** `src/components/onboarding/OnboardingGate.tsx`, step components, `src/lib/onboarding/form-options.ts`.

Store **wire values**, never display labels.

---

## Step order (quiz only)

`FITTING_STEPS` minus `verdict`. After honesty the app opens the verdict card and closes The Fitting from there.

| # | `step` | Screen | Required to leave? |
|---|--------|--------|--------------------|
| 1 | `consent` | Three yeses before a photo | All visible checkboxes |
| 2 | `photo` | Face photograph | No — skip allowed |
| 3 | `name` | Identity print | Name + clothing type + ≥1 style era |
| 4 | `fit` | Height / weight / build / shape | No |
| 5 | `life` | Weekdays / weekends / kids / climate | No |
| 6 | `spend` | How you buy | No |
| 7 | `worn` | Looks you actually wear | No — max 3 |
| 8 | `corner` | Honest Corner | No — skip allowed |
| 9 | `nolist` | Shops + never-wear | No |
| 10 | `honesty` | 1–5 slider. **Lock it in** | No (empty slider saves `3`) |

**Server complete** (`POST /api/onboarding`) still requires `preferredName`, `genderPresentation`, `ageRange`. `ageRange` is derived from birthday or style era — never asked as its own chip.

Tell-me box is on every question step except verdict. `POST /api/onboarding/fitting-tell` prefills later fields.

---

## Required vs optional

| Required | Where | Fields |
|----------|--------|--------|
| **To finish onboarding (server)** | `REQUIRED_ONBOARDING_FIELDS` | `preferredName`, `genderPresentation`, `ageRange` |
| **To leave `name` (client)** | `saveIdentity` | name, clothing type, ≥1 style era. Under-13 birthday is a hard stop. |
| **To leave `consent`** | checkboxes | `ageAttested`, `ownPhotoAttested`, and `abandonDeleteAck` when guest |

Everything else may be empty. Skipping a step writes nothing (or writes the honesty default `3` when they hit Lock it in).

---

## Step 1 — `consent`

Not stored on `UserProfile`. Local ticks so they can continue to photo.

| Prompt | Required | Value |
|--------|----------|--------|
| I am at least 13 years old. | yes | `ageAttested: true` |
| The photograph is of me. I agree to Shoop measuring me from it… | yes | `ownPhotoAttested: true` |
| If I leave without saving an account, delete this photograph… | yes when guest | `abandonDeleteAck: true` |

---

## Step 2 — `photo`

**Prompt:** tap the face on the card. Skip: `skip for now`.

| | |
|--|--|
| **Required** | no |
| **Stored** | local preview until identity exists; then `/api/avatar/upload`. Coverage is always `"face"`. **Not** a `UserProfile` column. |

Height / build are step 4 (`fit`), not this screen.

---

## Step 3 — `name` — `POST /api/onboarding/review`

**Title:** What do we put on the print?

### Preferred name — **required**

Free text ≤120 → `UserProfile.preferredName`.

### Clothing type — **required**

Prompt: “Which type of clothings do you shop for?”

| Value | Label |
|-------|-------|
| `menswear` | Menswear |
| `womenswear` | Womenswear |
| `both` | Both |

→ `UserProfile.genderPresentation`. Downstream department: menswear → `mens`, womenswear → `womens`, both → `mixed`. Bust chips on fit only when `womenswear`.

### Birthday — optional

Date `YYYY-MM-DD` or chip `Prefer not to say` (`birthDateSkipped`). Max date = today minus 13 years.

→ `UserProfile.birthDate` (null if skipped). Derives `ageRange` when present.

### Style era — **required** (at least one)

Prompt: “Which era is your style living in?” Multi-select. Stored as CSV on `UserProfile.styleEra`. First recognized era wins `ageRange` when birthday is skipped.

| Value | Chip | → `ageRange` |
|-------|------|----------------|
| `13_14` | 13–14 Figuring it out | `13-17` |
| `15_17` | 15–17 High-school | `13-17` |
| `18_22` | 18–22 Campus | `18-24` |
| `23_29` | 23–29 First-paycheck | `25-34` |
| `30s` | 30s Prime | `25-34` |
| `40s` | 40s Power | `35-44` |
| `50s_60s` | 50s–60s Refined | `55-64` |
| `65_plus` | 65+ Icon | `65+` |

`ageRange` values: `13-17` \| `18-24` \| `25-34` \| `35-44` \| `45-54` \| `55-64` \| `65+`.

---

## Step 4 — `fit` — `POST /api/onboarding/review` (sizing) + twin mint

All optional. Empty height does not write a fake cm.

| Prompt | Values | Stored |
|--------|--------|--------|
| How tall are you? | ft 4–7 + in 0–11, or cm 140–210 | `SizingProfile.heightCm` |
| And your weight? | 35–250 lb/kg, or Prefer not to say | `SizingProfile.weightKg` (null if skipped) |
| Your build | `slim` `average` `athletic` `broad` `plus` | `SizingProfile.bodyType` (defaults `average` on save if unset) |
| Definition | `low` Soft / `moderate` Toned / `high` Defined | Twin / avatar attributes only |
| Shape | `rectangle` `triangle` `inverted_triangle` `hourglass` `oval` | Twin only |
| Bust (womenswear) | `subtle` `average` `full` `very_full` | Twin only |
| Legs | `long_torso` `even` `long_leg` | Twin only |

Also writes `UserProfile.unitsLength` (`cm` \| `in`) and `unitsWeight` (`kg` \| `lb`).

---

## Step 5 — `life` — `POST /api/onboarding/review`

Weekdays / weekends / kids / climate are multi-select. Tap again to clear. Empty step → no write.

**Why are you here?** is single-select → `UserProfile.dressingFor`.

| Prompt | Values | Column |
|--------|--------|--------|
| Why are you here? | `work_polish` `feel_like_me` `nights_out` `stop_wasting` `find_style` + `other:<text>` | `UserProfile.dressingFor` |
| Your week days are: | `studying` `working_onsite` `working_home` `working_mixed` `own_thing` `home_with_kids` `between_things` `retired` + `other:<text>` | `UserProfile.weekIs` CSV |
| Your week ends are: | `home` `friends` `family` `outdoors` `errands` `nightlife` `travel` + `other:<text>` | `UserProfile.weekendsAre` CSV |
| Kids? | `none` `older` `young` | `UserProfile.kids` CSV |
| Climate where you live | `hot_humid` `hot_dry` `four_seasons` `mild_wet` `cold` | `UserProfile.climate` CSV |

Derived `lifestyleTags` (not asked): studying → `campus_life`; working_* → `deep_in_career`; own_thing → `running_the_show`; home_with_kids or kids young/older → `kids_in_the_mix`; retired → `time_is_mine`.

---

## Step 6 — `spend` — `POST /api/onboarding/review`

Optional multi + custom `custom:<label>`.

| Value | Label |
|-------|-------|
| `best_value` | Smart value |
| `premium` | Quality first |
| `luxury` | Luxury & designer |
| `deal_hunter` | Deal hunter |
| `design_first` | Design-led |

→ `UserProfile.valuePhilosophy` CSV.

---

## Step 7 — `worn` — `POST /api/onboarding/taste`

Optional. Max **3** cards. Continue with zero.

→ `TasteTag` rows, `category: "worn"`, `polarity: "positive"`. Also feeds computed `UserProfile.styleMix`.

---

## Step 8 — `corner` — `POST /api/onboarding/taste`

Optional free text ≤2000. Skip: “I'd rather not say”.

| Prompt | Column |
|--------|--------|
| What you don't like in your current style | `UserProfile.styleFriction` |
| What you want to improve or become | `UserProfile.styleBecome` |

---

## Step 9 — `nolist` — `POST /api/onboarding/taste`

Optional. Tap brand: once = shop here, twice = never, third = clear.

| UI | Stored |
|----|--------|
| I shop here | `BrandPreference` `sentiment: "love"` |
| Never show me | `BrandPreference` `sentiment: "avoid"` |
| Never-wear cards (comfort) | `HardNegative` `scope: "fit"`, `note: "comfort"` + `SizingProfile.sensitivities` |
| Never-wear cards (style) + typed vetoes | `HardNegative` `scope: "style"`, `reason: "taste"` |

Comfort wire values: `no heels`, `nothing sleeveless`, `nothing short`, `no tight fits`, `covered shoulders`, `nothing sheer`, `no low rise`, `no skinny jeans`, `no shorts`, `no sandals` (audience-gated).

---

## Step 10 — `honesty` — `POST /api/onboarding/taste` (`mark: "final"`)

1–5 slider. UI defaults to **3** if unset. Lock it in writes that value.

| Value | Label |
|-------|-------|
| `1` | Hit me easy |
| `2` | Kind but honest |
| `3` | Give it to me straight |
| `4` | Don't sugarcoat it |
| `5` | No mercy |

Legacy `gentle`→`1`, `straight`→`3`, `no_mercy`→`5`. → `UserProfile.honestyPreference`.

---

## Do not ask (not on the live quiz)

Country / city / currency / clothing sizes, occupation, `WORLD_OPTIONS` chips, compliment chips, `dressingFor` dating chips, numeric budget, full-body photo, Gentle as a third honesty tile.

---

## Worked example — Maya, 32, womenswear

What she tapped, then the rows that land.

### Answers

| Step | Wire |
|------|------|
| name | `preferredName: "Maya"`, `genderPresentation: "womenswear"`, `birthDate: "1994-03-12"`, `styleEra: "30s,23_29"` |
| fit | `heightCm: 168`, `weightKg: 62`, `bodyType: "average"`, `muscularity: "moderate"`, `bodyShape: "hourglass"`, `bustFullness: "average"`, `legLine: "even"` |
| life | `weekIs: "working_mixed,studying"`, `weekendsAre: "friends,nightlife"`, `kids: "none"`, `climate: "hot_humid,four_seasons"` |
| spend | `valuePhilosophy: "premium,best_value"` |
| worn | 2 looks → tags `worn` |
| corner | `styleFriction: "hoodies every day"`, `styleBecome: "more put-together"` |
| nolist | love `COS`, avoid `Shein`, comfort `no heels`, style `loud logos` |
| honesty | `3` |

### `UserProfile`

```json
{
  "preferredName": "Maya",
  "genderPresentation": "womenswear",
  "birthDate": "1994-03-12T12:00:00.000Z",
  "ageRange": "25-34",
  "styleEra": "30s,23_29",
  "weekIs": "working_mixed,studying",
  "weekendsAre": "friends,nightlife",
  "kids": "none",
  "climate": "hot_humid,four_seasons",
  "lifestyleTags": ["deep_in_career", "campus_life"],
  "valuePhilosophy": "premium,best_value",
  "styleFriction": "hoodies every day",
  "styleBecome": "more put-together",
  "honestyPreference": "3",
  "unitsLength": "cm",
  "unitsWeight": "kg",
  "onboardingStarted": true,
  "onboardingCompleted": true
}
```

`styleMix` is computed JSON from worn labels + honest-corner text (not typed by her).

### `SizingProfile`

```json
{
  "heightCm": 168,
  "weightKg": 62,
  "bodyType": "average",
  "sensitivities": ["no heels"]
}
```

Definition / shape / bust / legs stay on the avatar twin, not this table.

### Preference rows

```json
[
  { "table": "BrandPreference", "brand": "COS", "sentiment": "love" },
  { "table": "BrandPreference", "brand": "Shein", "sentiment": "avoid" },
  { "table": "HardNegative", "scope": "fit", "value": "no heels", "reason": "other", "note": "comfort" },
  { "table": "HardNegative", "scope": "style", "value": "loud logos", "reason": "taste" },
  { "table": "TasteTag", "category": "worn", "tag": "<from look labels>", "polarity": "positive" }
]
```

### Fashion-memory seed (`seedOnboardingIntoFashionMemory`)

Self person facts/signals, including `body_note` garment `onboarding-meta`:

```json
{
  "age_range": "25-34",
  "style_era": "30s,23_29",
  "week_is": "working_mixed,studying",
  "weekends_are": "friends,nightlife",
  "kids": "none",
  "climate": "hot_humid,four_seasons",
  "lifestyle_tags": ["deep_in_career", "campus_life"],
  "value_philosophy": "premium,best_value",
  "honesty_preference": "3",
  "style_friction": "hoodies every day",
  "style_become": "more put-together"
}
```

Router `context:` line (CSV-aware): `30s · deep in career · campus life · mix of home and office · studying · out with friends · nightlife · hot and humid · four seasons · quality-first spender · era: prime`.

---

## Save / validate / read map

| Step | Validate | Write | Read back |
|------|----------|-------|-----------|
| name / life / spend / fit numbers | `userProfilePatchSchema` / `sizingProfilePatchSchema` via `reviewPostSchema` | `applyOnboardingPatch` | `GET /api/onboarding` → `hydrateFromStatus` |
| worn / corner / nolist / honesty | `tastePostSchema` | `buildPatchFromTastePicks` → patch | same GET + taste tags / brands / hard negatives |
| tell-me | `fittingTellPostSchema` | same patch tables | prefill latch + hydrate |
| complete | missing required fields → 400 | `onboardingCompleted: true` + projection job | fashion router reads seeded facts |

Life CSVs (`weekIs`, `weekendsAre`, `climate`) are validated at 240 chars so a full multi-select cannot 400. Fashion-memory context splits those CSVs; `weekendsAre` is part of the onboarding-meta fact.
