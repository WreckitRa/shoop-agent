# In-house outfit styles — photo checklist

Curated **style library** for Shoop onboarding (`outfit-style-catalog.ts`).

These are **styles**, not worn-only / wanted-only assets. The same look can show as
“things I wear” for one person and “what I want” for another. Deck step only biases
ranking (soft formality) and excludes styles already picked.

## Where to put photos

```
public/onboarding/outfits/{id}.webp
```

Served at: `/onboarding/outfits/{id}.webp`

1. Save as `{id}.webp` (match catalog id)
2. Set in catalog: `imageUrl: "/onboarding/outfits/f-w-parisian-01.webp"`  
   or `imageUrl: outfitPhotoUrl("f-w-parisian-01")`
3. See also `public/onboarding/outfits/README.md`

- [ ] Total: **46** photos (one per `id`)
- Aspect: **vertical 2:3** (e.g. 1024×1536)
- Full body head-to-toe, soft natural light, soft bokeh bg
- No logos, brand names, text, or watermarks

**Global negative prompt**

```
runway drama, selfie crop, cut-off feet, logos, brand names, watermark, text, neon, over-filtered skin, illustration, 3d render, distorted hands
```

---

## Progress

| Section | Done |
|---------|------|
| Feminine library (18) | [ ] |
| Masculine library (18) | [ ] |
| Extras (10) | [ ] |

---

## Feminine · worn

| Done | id | label | one-line prompt |
|------|-----|-------|-----------------|
| [ ] | `f-w-parisian-01` | trench + café knit | Vertical 2:3 full-body Shoop worn tile: feminine woman in camel trench + soft cream café knit + dark trousers, Parisian everyday smart-casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-minimal-01` | black column day | Vertical 2:3 full-body Shoop worn tile: feminine woman in black column dress or all-black simplified day silhouette, minimal clean, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-romantic-01` | soft blouse + midi | Vertical 2:3 full-body Shoop worn tile: feminine woman in soft blush blouse + midi skirt, romantic everyday, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-street-01` | denim + white sneaks | Vertical 2:3 full-body Shoop worn tile: feminine (or soft androgynous) woman in indigo denim + white sneakers street casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-classic-01` | blazer + trousers | Vertical 2:3 full-body Shoop worn tile: feminine woman in navy blazer + tailored trousers work-smart, classic, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-sporty-01` | knit + easy joggers | Vertical 2:3 full-body Shoop worn tile: feminine athlete-casual in grey knit + easy joggers athleisure, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-boho-01` | linen shirt set | Vertical 2:3 full-body Shoop worn tile: feminine woman in sand linen shirt set relaxed boho, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-bold-01` | leather + graphic tee | Vertical 2:3 full-body Shoop worn tile: feminine woman in black leather jacket + subtle graphic tee bold casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-w-wild-01` | hoodie + leggings truth | Vertical 2:3 full-body Shoop worn tile: feminine woman in grey hoodie + leggings honest comfort (“real life”), soft natural light, soft bokeh, head-to-toe, no logos/text |

---

## Feminine · wanted

| Done | id | label | one-line prompt |
|------|-----|-------|-----------------|
| [ ] | `f-a-parisian-01` | quiet-luxury airport | Vertical 2:3 full-body Shoop wanted tile: feminine woman in cream cashmere quiet-luxury travel/airport look, elevated Parisian, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-minimal-01` | gallery black column | Vertical 2:3 full-body Shoop wanted tile: feminine woman in sculptural black gallery column evening/minimal formal, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-romantic-01` | garden party dress | Vertical 2:3 full-body Shoop wanted tile: feminine woman in romantic floral garden-party dress, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-street-01` | street-sharp night | Vertical 2:3 full-body Shoop wanted tile: feminine woman in black sharp street leather night out look, polished edge, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-classic-01` | tailored suit day | Vertical 2:3 full-body Shoop wanted tile: feminine woman in charcoal tailored power suit, classic elevated, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-sporty-01` | clean matching set | Vertical 2:3 full-body Shoop wanted tile: feminine woman in cream elevated matching athleisure set, clean sporty luxe, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-boho-01` | festival layers | Vertical 2:3 full-body Shoop wanted tile: feminine woman in earth-tone boho festival layers, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-bold-01` | sequin evening hit | Vertical 2:3 full-body Shoop wanted tile: feminine woman in gold/black sequin evening hit, bold glam occasion, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-wild-01` | architect coat moment | Vertical 2:3 full-body Shoop wanted tile: feminine woman in ivory architectural statement coat, sculptural stretch look, soft natural light, soft bokeh, head-to-toe, no logos/text |

---

## Masculine · worn

| Done | id | label | one-line prompt |
|------|-----|-------|-----------------|
| [ ] | `m-w-parisian-01` | trench + knit polo | Vertical 2:3 full-body Shoop worn tile: masculine man in camel trench + knit polo Parisian everyday smart, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-minimal-01` | black tee + clean pants | Vertical 2:3 full-body Shoop worn tile: masculine man in black tee + clean tailored pants, minimal casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-romantic-01` | soft oxford + chinos | Vertical 2:3 full-body Shoop worn tile: masculine man in soft blue oxford + chinos gentle classic-casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-street-01` | denim on denim | Vertical 2:3 full-body Shoop worn tile: masculine man in indigo denim-on-denim street casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-classic-01` | blazer + chinos day | Vertical 2:3 full-body Shoop worn tile: masculine man in navy blazer + chinos smart casual classic, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-sporty-01` | hoodie + joggers | Vertical 2:3 full-body Shoop worn tile: masculine man in grey hoodie + joggers athleisure, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-boho-01` | linen shirt + shorts | Vertical 2:3 full-body Shoop worn tile: masculine man in sand linen shirt + shorts coastal relaxed, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-bold-01` | statement jacket + tee | Vertical 2:3 full-body Shoop worn tile: masculine man in black statement jacket + tee bold casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-wild-01` | hoodie + jeans truth | Vertical 2:3 full-body Shoop worn tile: masculine man in grey hoodie + jeans honest comfort, soft natural light, soft bokeh, head-to-toe, no logos/text |

---

## Masculine · wanted

| Done | id | label | one-line prompt |
|------|-----|-------|-----------------|
| [ ] | `m-a-parisian-01` | quiet-luxury travel | Vertical 2:3 full-body Shoop wanted tile: masculine man in cream cashmere quiet-luxury travel kit, elevated Parisian, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-minimal-01` | gallery black kit | Vertical 2:3 full-body Shoop wanted tile: masculine man in all-black gallery formal minimal kit, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-romantic-01` | soft evening shirt | Vertical 2:3 full-body Shoop wanted tile: masculine man in soft ivory evening shirt + dark trousers elevated, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-street-01` | street-sharp night | Vertical 2:3 full-body Shoop wanted tile: masculine man in black sharp street leather night look, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-classic-01` | tailored suit day | Vertical 2:3 full-body Shoop wanted tile: masculine man in charcoal tailored suit power day, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-sporty-01` | clean athleisure set | Vertical 2:3 full-body Shoop wanted tile: masculine man in cream elevated matching athleisure set, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-boho-01` | coastal linen set | Vertical 2:3 full-body Shoop wanted tile: masculine man in sand coastal linen resort set elevated, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-bold-01` | black-tie adjacent | Vertical 2:3 full-body Shoop wanted tile: masculine man in black dinner-jacket / black-tie-adjacent formal, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-wild-01` | architect coat moment | Vertical 2:3 full-body Shoop wanted tile: masculine man in ivory architectural statement coat, soft natural light, soft bokeh, head-to-toe, no logos/text |

---

## Extras (campus · age · androgynous)

| Done | id | label | one-line prompt |
|------|-----|-------|-----------------|
| [ ] | `f-w-street-campus` | campus denim basics | Vertical 2:3 full-body Shoop worn tile: young feminine teen/campus woman in basic denim + sneakers, casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-w-street-campus` | campus tee + jeans | Vertical 2:3 full-body Shoop worn tile: young masculine teen/campus man in tee + blue jeans, casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `f-a-icon-refined` | refined cashmere day | Vertical 2:3 full-body Shoop wanted tile: mature feminine woman 50s–60s vibe in refined cream cashmere classic day, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `m-a-icon-refined` | refined navy jacket | Vertical 2:3 full-body Shoop wanted tile: mature masculine man 50s–60s vibe in refined navy jacket classic, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-w-street-02` | boxy denim layers | Vertical 2:3 full-body Shoop tile: androgynous person in boxy denim layered street look, indigo casual, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-w-minimal-02` | monochrome layers | Vertical 2:3 full-body Shoop tile: androgynous/unisex person in grey monochrome layered minimal smart, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-w-sporty-02` | track pants + knit | Vertical 2:3 full-body Shoop worn tile: androgynous person in grey track pants + knit sporty comfort, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-w-boho-02` | easy earth layers | Vertical 2:3 full-body Shoop worn tile: feminine/androgynous person in easy earth-tone boho layers, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-a-classic-02` | sharp tailoring cut | Vertical 2:3 full-body Shoop wanted tile: androgynous person in sharp navy tailored suit cut elevated classic, soft natural light, soft bokeh, head-to-toe, no logos/text |
| [ ] | `x-a-bold-02` | color-block statement | Vertical 2:3 full-body Shoop wanted tile: feminine/androgynous person in bright color-block statement look bold elevated, soft natural light, soft bokeh, head-to-toe, no logos/text |

---

## Suggested asset paths

After you generate, e.g.:

```
public/onboarding/outfits/{id}.webp
```

Then in catalog:

```ts
imageUrl: "/onboarding/outfits/f-w-parisian-01.webp",
```

---

## Master id checklist

- [ ] `f-w-parisian-01`
- [ ] `f-w-minimal-01`
- [ ] `f-w-romantic-01`
- [ ] `f-w-street-01`
- [ ] `f-w-classic-01`
- [ ] `f-w-sporty-01`
- [ ] `f-w-boho-01`
- [ ] `f-w-bold-01`
- [ ] `f-w-wild-01`
- [ ] `f-a-parisian-01`
- [ ] `f-a-minimal-01`
- [ ] `f-a-romantic-01`
- [ ] `f-a-street-01`
- [ ] `f-a-classic-01`
- [ ] `f-a-sporty-01`
- [ ] `f-a-boho-01`
- [ ] `f-a-bold-01`
- [ ] `f-a-wild-01`
- [ ] `m-w-parisian-01`
- [ ] `m-w-minimal-01`
- [ ] `m-w-romantic-01`
- [ ] `m-w-street-01`
- [ ] `m-w-classic-01`
- [ ] `m-w-sporty-01`
- [ ] `m-w-boho-01`
- [ ] `m-w-bold-01`
- [ ] `m-w-wild-01`
- [ ] `m-a-parisian-01`
- [ ] `m-a-minimal-01`
- [ ] `m-a-romantic-01`
- [ ] `m-a-street-01`
- [ ] `m-a-classic-01`
- [ ] `m-a-sporty-01`
- [ ] `m-a-boho-01`
- [ ] `m-a-bold-01`
- [ ] `m-a-wild-01`
- [ ] `f-w-street-campus`
- [ ] `m-w-street-campus`
- [ ] `f-a-icon-refined`
- [ ] `m-a-icon-refined`
- [ ] `x-w-street-02`
- [ ] `x-w-minimal-02`
- [ ] `x-w-sporty-02`
- [ ] `x-w-boho-02`
- [ ] `x-a-classic-02`
- [ ] `x-a-bold-02`
