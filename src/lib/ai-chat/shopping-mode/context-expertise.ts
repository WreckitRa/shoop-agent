/**
 * Context expertise — when the user names a context Shoop knows about
 * (Burning Man, ski trip, wedding guest…), we inject expert knowledge
 * about what that context *actually* requires, beyond literal product
 * matching. This makes Shoop feel like a friend who's been there.
 *
 * Each entry is a short, opinionated brief — kept tight so the prompt
 * doesn't bloat. Patterns are case-insensitive; the first match wins.
 */

export type ContextExpertise = {
  /** Stable machine tag. */
  tag: string;
  /** Human label for the UI (badge / mode-resolved event). */
  label: string;
  /** Regex tests the raw user text against. First hit selects this context. */
  patterns: RegExp[];
  /** XML body injected into the prompt — bullet list, no leading whitespace. */
  brief: string;
};

const ENTRIES: ContextExpertise[] = [
  {
    tag: "burning_man",
    label: "Burning Man",
    patterns: [/\bburning\s*man\b/iu, /\bblack\s*rock\s*city\b/iu, /\bplayas?\b/iu],
    brief: `Context: Burning Man / Black Rock Desert.
Non-negotiables: alkaline dust (everything gets coated — light colors hide it best, leather + fine fabrics get destroyed), 100°F day / 40°F night swing, thin air, blowing dust requires sealed eyes + N95-grade respirator at minimum.
Function: goggles (ski/MX-style, NOT sunglasses), dust mask or respirator, headlamp + EL wire / LEDs (you WILL get hit by a bike at night without lights), insulated water bottle, sturdy closed-toe boots (no flip-flops — playa cracks open feet).
Vibe: utility-meets-costume; layers you can shed; faux fur for cold nights; bright prints because monochrome disappears in dust.
Watch-outs: cotton tees go grey forever; avoid pristine sneakers; nothing that needs charging without solar/USB battery.`,
  },
  {
    tag: "ski_trip",
    label: "Ski / snowboard trip",
    patterns: [
      /\bski(?:ing)?\s+trip\b/iu,
      /\bsnow(?:board(?:ing)?)?\s+trip\b/iu,
      /\bski\s+(?:vacation|week)\b/iu,
      /\bgoing\s+ski(?:ing)?\b/iu,
    ],
    brief: `Context: ski / snowboard trip.
Layering system (this matters more than any single item):
- Base: merino or synthetic (NEVER cotton — it freezes wet).
- Mid: fleece or synthetic puffy for insulation; remove at lunch.
- Shell: waterproof + windproof jacket + pants, 10k mm waterproof minimum, 15k+ if it's the PNW / wet Alps.
Essentials people forget: helmet (rentals are gross), goggles with low-light + bright-light lenses or photochromic, neck gaiter, mid-weight gloves + a backup pair (wet gloves = day over), thick wool socks (ONE pair per day; double-up causes blisters).
Après: insulated boots for the village, a cozy sweater, knit hat. Skip cotton hoodies — they stay damp in lodges.
If beginner: rent the boots locally (boot fit dominates everything); buy only outerwear + base layers.`,
  },
  {
    tag: "wedding_guest",
    label: "Wedding guest",
    patterns: [
      /\bwedding\s+guest\b/iu,
      /\b(?:attending|invited\s+to)\s+a\s+wedding\b/iu,
      /\b(?:going|invited)\s+to\s+a\s+wedding\b/iu,
    ],
    brief: `Context: wedding guest outfit.
Decode the dress code FIRST — it's the only constraint that matters:
- "Black tie": tuxedo or floor-length gown; no exceptions.
- "Formal / black tie optional": dark suit or long/midi dress.
- "Cocktail": suit (mid/dark, can be lighter in summer) or knee-length dress; this is the safe default.
- "Semi-formal": same as cocktail, slightly more relaxed fabrics.
- "Beach / garden / festive": linen suit, midi dress, dressy sandals — avoid stilettos on grass/sand.
- No code given: cocktail.
Etiquette: never wear white / cream / ivory (uninvited bride competition). Avoid all-black at daytime weddings in some cultures. Match formality of shoes to outfit — leather dress shoes / heels, not sneakers.
Comfort > look: dancing for 6+ hours; pack flats; consider a small clutch you can hold while dancing.`,
  },
  {
    tag: "moving_pnw",
    label: "Moving to the Pacific Northwest",
    patterns: [
      /\bmoving\s+to\s+(?:seattle|portland|vancouver|tacoma)\b/iu,
      /\b(?:relocating|moved)\s+to\s+(?:seattle|portland|vancouver)\b/iu,
    ],
    brief: `Context: moving to the Pacific Northwest (Seattle / Portland / Vancouver).
Climate truth: 8 months of 45–55°F drizzle, not heavy rain — locals don't use umbrellas, they layer.
Wardrobe priorities:
- A real rain shell (Gore-Tex or equivalent, hooded) — daily driver.
- Waterproof or treated leather boots; suede dies here.
- Mid-layer fleece + a packable puffy for shoulder seasons.
- Wool socks year-round.
- Hat with a brim, dark colors so drizzle marks don't show.
Lifestyle: outdoorsy default — daypack, insulated bottle, headlamp for fall/winter trails. Indoor culture is casual; a button-down + jeans + boots reads "dressed up" in tech offices.
Skip: heavy ski-grade down jackets (overkill), fragile leather, white sneakers.`,
  },
  {
    tag: "music_festival",
    label: "Music festival",
    patterns: [
      /\bcoachella\b/iu,
      /\btomorrowland\b/iu,
      /\bglastonbury\b/iu,
      /\b(?:music\s+)?festival\b/iu,
    ],
    brief: `Context: outdoor multi-day music festival.
Comfort dominates style on day 3:
- Sneakers or low boots you've already broken in — NEVER new shoes; concrete + 25k steps will end you.
- Sun protection: brimmed hat, polarized sunglasses, SPF stick, breathable long sleeves for noon sets.
- Layers: 90°F day, 55°F night isn't unusual; pack a lightweight zip-up.
- Crossbody bag or small backpack (festival-policy-compliant: usually <12"x12", clear if US).
- Tiny rain shell that packs to a fist.
Hydration > everything: insulated 32oz bottle if allowed; refill stations save the day.
Costume layer: ONE statement piece per day (bandana, sunglasses, vintage tee) — don't out-costume yourself.`,
  },
  {
    tag: "first_date",
    label: "First date",
    patterns: [/\bfirst\s+date\b/iu, /\bdate\s+night\s+outfit\b/iu],
    brief: `Context: first date outfit.
Goals: look like the best, most-confident version of yourself, not a costume.
Rules of thumb:
- Match the venue's formality + 5% (slightly sharper than the room).
- Wear something you've worn before and got compliments on — first date is the wrong time to debut a new fit.
- Avoid logos / brand-heavy pieces; quiet confidence > announcing the budget.
- Comfort matters: stiff shoes / scratchy collars distract you.
- One conversation-piece item is great (interesting watch, well-made jacket); a head-to-toe statement is too much.
Hygiene-adjacent: subtle fragrance applied 20 min before, not five; freshly trimmed nails; well-fitting underwear (sounds dumb, drives confidence).`,
  },
  {
    tag: "job_interview",
    label: "Job interview",
    patterns: [/\bjob\s+interview\b/iu, /\binterview\s+outfit\b/iu],
    brief: `Context: job interview outfit.
Decode by industry FIRST:
- Finance / law / consulting: tailored suit, neutral shirt/blouse, leather shoes. Conservative wins.
- Tech (FAANG/startup): smart-casual — clean dark jeans or chinos, button-down or knit polo, clean leather sneakers or loafers. Suits read out-of-touch.
- Creative / agency: personal style with intentional pieces — show taste, not effort.
- Trades / on-site roles: clean work pants + collared shirt; closed-toe boots if site tour likely.
Universal rules: nothing wrinkled; matching belt + shoes for formal; no overpowering fragrance; remove logos if budget-conscious — they distract.
Bring: portfolio / notebook bag (not a backpack for formal industries), water bottle, mints.`,
  },
  {
    tag: "honeymoon",
    label: "Honeymoon",
    patterns: [/\bhoneymoon\b/iu],
    brief: `Context: honeymoon packing.
Frame: ONE great outfit per dinner reservation + minimal versatile basics by day. Don't overpack.
Day kit: 2 swim pieces, 1 linen overshirt, packable sun hat, polarized sunglasses, walking sandals you've broken in.
Evening kit: 2 dressy looks rotated (e.g. linen suit / midi dress) + leather sandals or loafers.
Couple-specific: matching-but-not-twinning pieces for photos; a small dressy item from each partner photographs better than two t-shirts.
Function: reef-safe SPF, refillable bottle, a packable tote for beach days, anti-chafe balm.`,
  },
  {
    tag: "new_baby",
    label: "New baby / parent",
    patterns: [/\bnew\s+baby\b/iu, /\bbaby\s+shower\b/iu, /\bnewborn\b/iu, /\bexpecting\b/iu],
    brief: `Context: gifts / kit for a new baby or new parents.
Parents-first lens (the parents are the underrated recipient):
- Highly practical wins: a great diaper bag, a sturdy stroller blanket, an oversized swaddle.
- Sleep + soothing: white-noise machine, blackout shades, baby monitor.
- Skin: fragrance-free wash + balm; no scented products.
Baby kit by size, not age: most newborn clothes are outgrown in 4–6 weeks — skip newborn-size unless tiny baby; go for 3–6m to actually get worn.
Avoid: more onesies (everyone gifts onesies), stuffed animals (already drowning), anything that needs assembly without instructions translated for sleep-deprived adults.`,
  },
  {
    tag: "camping_backpacking",
    label: "Camping / backpacking",
    patterns: [
      /\bcamping\s+trip\b/iu,
      /\bbackpacking\b/iu,
      /\bthru[- ]hike\b/iu,
      /\bcar\s+camping\b/iu,
    ],
    brief: `Context: camping / backpacking trip.
Distinguish CAR camping from BACKPACKING — weight tolerance is opposite:
- Car: bring comfort (cot, real chair, cast iron). Weight irrelevant.
- Backpacking: every gram matters; base weight <20 lbs is the target.
Big Three (60% of weight): pack, shelter, sleep system. Spend here first.
Layering: synthetic or merino base, fleece/puffy mid, rain shell (NOT a poncho).
Essentials hikers forget: headlamp (NOT phone flashlight), tested filter, fire starter that works wet, blister kit (Leukotape).
Footwear: trail runners for most backpackers now beat boots (lighter, dry faster); boots only for heavy loads or rocky scree.
Food: instant calories — bars, ramen, peanut butter, freeze-dried for dinners.`,
  },
  {
    tag: "back_to_school",
    label: "Back to school",
    patterns: [
      /\bback[- ]to[- ]school\b/iu,
      /\bgoing\s+to\s+(?:college|university)\b/iu,
      /\bstart(?:ing)?\s+(?:college|uni|university|school)\b/iu,
    ],
    brief: `Context: back-to-school / starting college.
Dorm efficiency: storage is the bottleneck — bed risers, under-bed bins, over-door hooks, a shower caddy beat any clothing piece.
Wardrobe: 2 weeks of mix-and-match basics (5 tops, 3 bottoms, 1 jacket, 1 dressy outfit). Resist a closet of new pieces — fit + repeat wins.
Tech: laptop + sleeve, noise-cancelling earbuds for study, a reliable wired backup of your charger (gets stolen / lost constantly).
Personal: bathrobe + flip-flops for shared bathrooms, ear plugs + eye mask, mini first-aid + cold-medicine kit.
Skip: a printer (use the library), tons of decor (you'll move in 8 months), brand-new shoes you haven't broken in.`,
  },
  {
    tag: "home_office",
    label: "Home office / remote work setup",
    patterns: [
      /\bhome\s+office\b/iu,
      /\bremote\s+work\s+setup\b/iu,
      /\bwfh\s+(?:setup|desk)\b/iu,
      /\bdesk\s+setup\b/iu,
    ],
    brief: `Context: home office / remote work setup.
Ergonomic stack (in priority order — fix these first):
1. Chair you can sit in for 8 hours (Aeron / Steelcase / equivalent; don't cheap out — this is the #1 lever).
2. Monitor at eye level (laptop on a stand or external 27" 1440p/4K).
3. External keyboard + mouse so the laptop can sit at the right height.
Lighting: overhead + a key-light or window to one side; bad lighting wrecks both eyestrain and Zoom credibility.
Audio first impression: a USB mic or quality headset > camera quality — people forgive a fuzzy face, not muffled audio.
Quiet wins: anti-fatigue mat, cable management tray, a kettle/coffee station so you're not breaking flow.
Skip until you have above: RGB anything, a second monitor before sorting ergonomics, ultra-wide before you've used dual displays.`,
  },
  // ── New contexts (W5) ───────────────────────────────────────────────────
  {
    tag: "gym_crossfit",
    label: "Gym / CrossFit",
    patterns: [
      /\bgym\s+(?:outfit|kit|gear|clothes|bag)\b/iu,
      /\bcrossfit\b/iu,
      /\bweight\s*(?:lifting|room|training)\s+(?:shoes?|gear|outfit)\b/iu,
      /\bwod\b/iu,
    ],
    brief: `Context: gym / CrossFit training.
Footwear first: flat, wide-toe-box lifting shoes (e.g. Nike Metcon, Reebok Nano) for WODs and lifting — NOT running shoes (too much cushion = unstable under a barbell).
Clothing: shorts with a 5" inseam minimum for squats, compression shorts under if needed, moisture-wicking tee or tank. Avoid cotton — it gets heavy and chafing.
Lifting accessories: wrist wraps + knee sleeves if you're going heavy; chalk > straps for most pull movements.
Bag: small gym bag or drawstring that fits shoes + shaker + extra clothes; most boxes don't have lockers.
Watch-outs: avoid overly stiff materials for mobility work; a jump rope bag is the single most lost item.`,
  },
  {
    tag: "running",
    label: "Running / training",
    patterns: [
      /\brunning\s+(?:shoes?|gear|kit|outfit)\b/iu,
      /\bmarathon\b/iu,
      /\bhalf\s*marathon\b/iu,
      /\b5k\b/iu,
      /\btrail\s*running\b/iu,
      /\bjog(?:ging)?\s+(?:shoes?|gear)\b/iu,
    ],
    brief: `Context: running / race training.
Shoe type matters more than brand:
- Road: neutral if no overpronation, stability if you roll in. Stack height: 8–10mm drop for most runners; zero-drop only if you've built up.
- Trail: more grip lugs, rock plate for rocky terrain; same drop preference.
- Race day: carbon-plated supershoes (Vaporfly, Alphafly, Endorphin Pro) knock 2–5% off time — worth it for HM+. Rotate with a daily trainer.
Clothing: synthetic or merino (NO cotton); reflective for road running at dusk/dawn; compression socks reduce calf fatigue on long runs.
Accessories: GPS watch, hydration vest for runs > 10 mi, anti-chafe balm (Body Glide) — the single most underrated item.`,
  },
  {
    tag: "beach_vacation",
    label: "Beach vacation",
    patterns: [
      /\bbeach\s+(?:vacation|holiday|trip|week)\b/iu,
      /\btropical\s+(?:vacation|getaway|trip)\b/iu,
      /\b(?:going to|heading to)\s+(?:the\s+)?beach\b/iu,
    ],
    brief: `Context: beach / tropical vacation.
Swim first: board shorts or a swimsuit that dries fast (polyester or nylon, NOT cotton). Two suits so one is always dry.
Cover-ups: a linen or cotton gauze shirt, not a terry cloth robe unless you want to look like a hotel.
Footwear: one pair of flip-flops for the beach, one pair of leather sandals or espadrilles for dinner — two pairs covers everything.
SPF stack: SPF 50 stick for face (easy reapplication), SPF 30+ spray for body, lip balm SPF 30+. Reef-safe formula if going in the ocean.
Bag: mesh beach bag or packable tote. Waterproof phone pouch. A small first-aid kit with after-sun gel.
Evening: one lightweight linen outfit (pants or dress) that reads "resort casual" — most tropical restaurants have a soft no-swimwear policy.`,
  },
  {
    tag: "road_trip",
    label: "Road trip",
    patterns: [
      /\broad\s*trip\b/iu,
      /\bdriving\s+(?:across|through|trip)\b/iu,
    ],
    brief: `Context: road trip (car-based travel).
Comfort over everything: you're sitting for hours. Stretchy pants or shorts, a soft layer to sleep/rest in, a neck pillow.
Car kit: car phone mount (non-negotiable for maps), a portable charger or 12V USB hub (not just the one built-in), a reusable water bottle and a small cooler bag.
Emergency kit: roadside triangle + jumper cables + a tire inflator. One blanket in the trunk.
Entertainment: wired earbuds for a passenger, a Kindle or tablet in a durable case.
Skip: heavy luggage — everything should fit in the back with room to see. Packing cubes make trunk Tetris fast.`,
  },
  {
    tag: "travel_capsule",
    label: "Travel capsule wardrobe",
    patterns: [
      /\btravel\s+(?:capsule|wardrobe|packing)\b/iu,
      /\bpacking\s+(?:light|minimal|carry[- ]on)\b/iu,
      /\bcarry[- ]on\s+only\b/iu,
      /\bone\s+bag\s+travel\b/iu,
    ],
    brief: `Context: carry-on / one-bag travel wardrobe.
The formula: 3 bottoms + 5 tops + 1 dress layer + 1 versatile shoe = 10 days, one carry-on.
Fabric rules: merino wool (odor-resistant, packs small, wrinkle-resistant), synthetic quick-dry for bottoms, avoid denim (heavy, slow to dry).
Color system: anchor in navy, black, or grey so everything mixes. One accent piece for photos.
Shoes: 2 pairs max — one versatile walking shoe (Allbirds, Veja) + one dress sandal or Chelsea boot. Pack shoes in shower caps to keep clothes clean.
Tech: packing cubes compress + organize; a compression sack for your jacket saves half a liter of space.
Skip: anything that only works with one other item, travel pillows (use a fleece), full-size toiletries.`,
  },
  {
    tag: "surfing",
    label: "Surfing trip",
    patterns: [
      /\bsurf(?:ing)?\s+trip\b/iu,
      /\bsurf(?:ing)?\s+(?:gear|kit|lesson)\b/iu,
      /\blearn(?:ing)?\s+to\s+surf\b/iu,
    ],
    brief: `Context: surfing trip.
Board choice for beginners: foam longboard (8–10 ft) — more stable, faster to learn. Rent before buying.
Wetsuit: 3/2 mm for water 58–68°F, 4/3 for colder. Boots + gloves + hood under 50°F. Fit matters more than brand.
Rash guard: long-sleeve for sun + reef protection; even on warm days.
Wax: tropical, warm, cool, or cold formula depending on water temp — wrong wax = slippery board.
Beach bag: waterproof bag, fin key, leash, board shorts that double as shorts.
Watch-outs: never surf alone as a beginner; currents, rocks, and other surfers are the real hazards, not sharks.`,
  },
  {
    tag: "yoga_pilates",
    label: "Yoga / Pilates",
    patterns: [
      /\byoga\s+(?:mat|clothes?|outfit|gear|studio)\b/iu,
      /\bpilates\s+(?:reformer|studio|gear|clothes?)\b/iu,
      /\bhot\s+yoga\b/iu,
    ],
    brief: `Context: yoga / Pilates.
Mat: 4mm for travel + portability (PVC or TPE), 6mm for joint support in home practice. Natural rubber grips best for sweaty hands.
Clothing: 4-way stretch leggings or shorts + fitted top that won't fall over your head in inversions. Grippy socks for Pilates reformer (mandatory in most studios).
Hot yoga: moisture-wicking synthetic only, never cotton. Pack a yoga towel to drape over the mat. Electrolytes for after class.
Extras: a good yoga block pair + strap for home practice; a mat bag for studio going.
Watch-outs: most "yoga pants" brands differ hugely in squat-proof opacity — check reviews; dark colors and patterned fabrics hide this better.`,
  },
  {
    tag: "cycling",
    label: "Cycling",
    patterns: [
      /\bcycling\s+(?:kit|gear|shoes?|helmet)\b/iu,
      /\bbike\s+(?:commute|commuting|ride|gear)\b/iu,
      /\broad\s+(?:bike|cycling)\s+(?:gear|kit)\b/iu,
      /\bgravel\s+(?:cycling|bike|riding)\b/iu,
    ],
    brief: `Context: cycling (road / gravel / commute).
The padded shorts rule: chamois = no underwear underneath. This is non-negotiable for rides > 30 min. Bib shorts > regular shorts (no waistband).
Jersey: moisture-wicking, back pockets for food + tools, bright colors for visibility.
Shoes + pedals are a system: clip-in (SPD-SL for road, SPD for gravel/commute) saves 10–15% energy vs flat pedals. Fit to pedals before buying shoes.
Helmet: replace every 5 years or after any impact. MIPS liner adds rotational protection for <$30 premium — worth it.
Commuting kit: front + rear lights (flash pattern > solid for visibility), fenders in wet climates, a rear rack or saddle bag > backpack for long commutes.`,
  },
  {
    tag: "outdoor_hiking",
    label: "Hiking / outdoors",
    patterns: [
      /\bhiking\s+(?:boots?|shoes?|gear|pants?|jacket)\b/iu,
      /\bday\s+hike\b/iu,
      /\btrail\s+(?:shoes?|running|hike)\b/iu,
    ],
    brief: `Context: hiking / day trail.
Footwear: trail runners beat hiking boots for most day hikes (lighter, faster drying). Boots only for heavy pack or technical scrambling. Waterproof membrane (GTX) = warmer + heavier; skip it for dry trails.
Layering: moisture-wicking base (merino or synthetic), mid-layer (fleece or light puffy), rain shell. Temperatures drop fast at elevation; carry more layers than you think you need.
Pack: 20–30L daypack for a full day. Hydration reservoir or 2× 1L bottles. High-cal snacks (bars, nuts, dried fruit).
Essentials: map/GPS + compass (phone dies), sun hat + sunscreen, first aid + blister kit (Leukotape).
Watch-outs: cotton kills at altitude — soaks, chills, won't dry. Never wear jeans on a real hike.`,
  },
  {
    tag: "winter_everyday",
    label: "Winter everyday wardrobe",
    patterns: [
      /\bwinter\s+(?:wardrobe|clothes?|outfit|coat|jacket)\b/iu,
      /\bstay\s+warm\s+(?:in|this)\s+winter\b/iu,
      /\bcold\s+weather\s+(?:clothes?|outfits?|wardrobe)\b/iu,
    ],
    brief: `Context: everyday winter wardrobe (urban / cold city).
The layering formula: thermal base + mid-layer + outer shell.
Coat priority: a quality topcoat or parka is a 5-year investment — spend here. Down for dry cold, synthetic fill for wet climates (down loses insulation when wet).
Base layers: merino wool (soft, odor-resistant, temperature-regulating). Keep 3–4 on rotation.
Accessories make or break cold-weather comfort: insulated gloves (not fashion gloves), a beanie that covers ears, a scarf or neck gaiter for wind.
Footwear: waterproof Chelsea boots or ankle boots for city walking; insulated options for actual snow.
Watch-outs: don't buy a heavy parka if you mostly commute indoors — you'll be soaking on the subway.`,
  },
  {
    tag: "summer_everyday",
    label: "Summer everyday wardrobe",
    patterns: [
      /\bsummer\s+(?:wardrobe|clothes?|outfits?|essentials?)\b/iu,
      /\bhot\s+weather\s+(?:clothes?|outfits?|wardrobe)\b/iu,
    ],
    brief: `Context: summer everyday wardrobe (hot weather city).
Fabrics: linen > cotton > synthetic. Linen breathes the best and softens with washing. Avoid polyester blends for anything worn against skin.
Staples: 2–3 linen shirts (one white, one neutral), chinos or linen trousers, a pair of well-fitting shorts (5" inseam city-appropriate), one airy dress/jumpsuit.
Shoes: leather sandals or loafers that won't trap heat. White sneakers get heavy in 30°C+.
Sun protection: a packable UV-blocking hat, polarized sunglasses. SPF 30 daily — visible aging is cumulative.
Watch-outs: tight-fit clothing in heat is miserable. Size up one; summer is not the season for slim cuts.`,
  },
  {
    tag: "new_parent",
    label: "New parent wardrobe",
    patterns: [
      /\bnew\s+(?:parent|mom|dad|father|mother)\s+(?:clothes?|outfits?|wardrobe)\b/iu,
      /\b(?:postpartum|maternity)\s+(?:clothes?|wardrobe|style)\b/iu,
    ],
    brief: `Context: new parent / postpartum wardrobe.
Practical wins: machine-washable everything (the only rule). Dark colors hide spit-up. Stretchy waistbands for the first 6 months.
Nursing-friendly: wrap tops, button-front shirts, and deep-V knits work for nursing without special cuts.
Comfort-first: you're sleep-deprived and carrying a baby. Slip-on shoes (loafers, sneakers with elastic laces), soft joggers, oversized hoodies.
Postpartum body: sizing changes. Buy 2–3 versatile pieces that work across sizes rather than a full wardrobe. High-waist pants extend the useful range.
Skip: dry-clean only anything, stiff denim for the first 3 months, anything that requires more than 30 seconds to put on.`,
  },
  {
    tag: "safari",
    label: "Safari trip",
    patterns: [
      /\bsafari\b/iu,
      /\bsafarI\s+(?:trip|clothes?|packing)\b/iu,
    ],
    brief: `Context: safari (Africa / wildlife game drive).
Color matters: khaki, tan, olive, green — blend with the bush. Avoid white (dusty), black (attracts tsetse flies in East Africa), or bright colors.
Fabric: lightweight breathable long sleeves + long pants for both sun and insect protection. Convertible zip-off pants cover both.
Layers: game drives are cold at dawn and dusk; a fleece or light down jacket is essential even in warm countries.
Footwear: closed-toe walking shoes or light boots — sandals only at the lodge.
Accessories: wide-brim hat, polarized sunglasses (reduces glare for photos), quality binoculars > camera for first-timers.
Watch-outs: malaria risk in most safari areas — lightweight long sleeves + DEET matter more than any specific brand.`,
  },
  {
    tag: "sneaker_culture",
    label: "Sneakers / streetwear",
    patterns: [
      /\bsneaker\s+(?:head|culture|collection|drops?)\b/iu,
      /\bstreet\s*wear\b/iu,
      /\bhypebeast\b/iu,
    ],
    brief: `Context: sneaker culture / streetwear.
Fit hierarchy: silhouette > colorway > brand. The right fit in the wrong color is fixable; the wrong fit in the right color isn't.
Sizing: many hype silhouettes run long (Jordans, Dunks) — go half down. Yeezys run short — go half up. Always check Reddit/Kickscrew sizing notes.
Styling: monochrome or tonal outfits let the shoe be the hero. Overly branded head-to-toe looks dated.
Investment pieces: "hero" silhouettes hold value (Jordan 1s, Dunk Lows, AF1s, New Balance 990). Fast-fashion collabs don't.
Watch-outs: fake markets are sophisticated; only buy from StockX, GOAT, Flight Club, or direct retail for resale-value items.`,
  },
  {
    tag: "smart_casual_men",
    label: "Smart casual (men)",
    patterns: [
      /\bsmart\s*casual\b/iu,
      /\bbusiness\s*casual\b/iu,
    ],
    brief: `Context: smart casual / business casual (men).
The safe formula: chinos + OCBD button-down + leather sneakers or loafers. Overdressed is better than under.
Elevated version: tailored trousers + fitted merino crewneck or quarter-zip + Chelsea boots.
Watch-outs: skinny jeans read casual not smart. Dress shoes with jeans only if the jeans are dark and the shoes are quality.
Layers that work: a blazer instantly smarts up any smart-casual outfit; navy or charcoal blazer is the most versatile. Bombers keep it young and casual.
Skip in this context: graphic tees, hoodies as an outer layer, running shoes or chunky trainers unless the environment is creative.`,
  },
  {
    tag: "outdoor_adventure",
    label: "Outdoor / adventure travel",
    patterns: [
      /\badventure\s+travel\b/iu,
      /\boutdoor\s+adventure\b/iu,
      /\bpatagonia\s+trip\b/iu,
      /\btrekking\b/iu,
    ],
    brief: `Context: multi-day outdoor / adventure travel.
System thinking: base + mid + shell + sun protection. Every layer must earn its weight.
Base: merino or synthetic, long-sleeve for sun + insect. Change daily; merino handles 2 days.
Mid: synthetic puffy (compresses, dries fast) > down in wet conditions.
Shell: 2L+ hardshell for serious mountains; DWR-coated softshell for light conditions.
Footwear: trail runners for maintained trails; leather boots for off-trail with load > 25 lbs.
Navigation: GPS watch or downloaded offline maps — cell service disappears fast.
Critical often-missed: sun gaiter / neck buff, anti-blister kit, electrolyte tablets for heat + altitude.`,
  },
];


export function detectContextExpertise(text: string): ContextExpertise | null {
  if (!text) return null;
  for (const entry of ENTRIES) {
    for (const re of entry.patterns) {
      if (re.test(text)) return entry;
    }
  }
  return null;
}

export function getContextExpertiseByTag(
  tag: string | null | undefined,
): ContextExpertise | null {
  if (!tag) return null;
  return ENTRIES.find((e) => e.tag === tag) ?? null;
}

export function contextExpertiseSystemBlock(
  ctx: ContextExpertise | null,
): string {
  if (!ctx) return "";
  return `<context_expertise tag="${ctx.tag}" label="${ctx.label}">
${ctx.brief}
</context_expertise>`;
}
