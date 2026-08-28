# Pilot — ten real users

Visit 2 only knows what visit 1 wrote. Purchase memory is the proof of the
product: she bought the navy Percival, you greet her with it next time.

## Checkout must be first-party Rye

Purchase events are written **only** on Rye confirm / retrieve when
`state=completed` (`completeCheckoutPurchase` → `writePurchaseMemory`).

Shopify merchant handoff cannot correlate `userId`. An outbound click, a
merchant checkout, or any path that leaves Shoop **writes nothing**. Visit 2
then has no Percival to recall.

**The ten real users must check out through the in-app Rye flow.** That is a
pilot constraint, not a footnote. If someone buys off-platform, treat that
session as having no purchase memory.

## Day-one alert

A completed first-party checkout with no `search_id` (or no `ref`) writes
nothing and must not stay silent. Grep production logs for:

```
[PILOT][P0] purchase_memory_missing_search_id
```

That string is `console.error` in `purchase-from-checkout.ts` (`logAiChat` is
a no-op). If it fires on day one, the cart line never got the assistant
message id — fix add-to-cart stamping before anyone comes back for visit 2.
