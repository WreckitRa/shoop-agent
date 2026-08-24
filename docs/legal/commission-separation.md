# Commission is not a ranking input

**Claim (ToS §7):** the recommendation engine does not receive commission rates as an input. It cannot rank a garment higher because we would earn more on it, because the number is not available to it.

**What the software does:** ranking uses Shopify retrieval rank, corroboration, size, rating, palette, department, and stated-brand match (`src/lib/fashion-memory/scoring/weights.ts`). Router briefs, catalog product types, and curator candidate dumps have no commission, affiliate, payout, CPC, CPA, or revshare fields. Shopify catalog search and Rye checkout do not pass a rate into the fashion pipeline.

**Substantiation:** `src/lib/fashion-memory/scoring/scoring.test.ts` — “commission is not a scoring input”. It fails CI if those words appear as identifiers in ranking-layer source, or on the keys of weights, catalog product, and search brief objects.

**FASHN / checkout:** commission is attributed after a click-out or purchase. That path is outside scoring.

**Re-verify:** run `npm test` (this file is in the test script). Re-run when ranking types, weights, or curator input change.

Last reviewed: 2026-08-24.
