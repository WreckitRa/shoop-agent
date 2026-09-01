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

## Day-one alerts

A completed first-party checkout with no `search_id` (or no `ref`) writes
nothing and must not stay silent. Every P0, including
`purchase_memory_missing_search_id`, inserts a row in `pilot_alerts` **and**
`console.error`s `[PILOT][P0] <code>`.

Dashboard: `/admin/pilot-health` (last 24h).

Daily query (service role):

```sql
select created_at, code, severity, payload
from public.pilot_alerts
where created_at > now() - interval '24 hours'
order by created_at desc;
```

If `purchase_memory_missing_search_id` fires on day one, the cart line never
got the assistant message id — fix add-to-cart stamping before anyone comes
back for visit 2.

## Founder smoke (production, not the eval harness)

Do this on a real phone against production, cheap item, in-app Rye checkout:

1. Signed-in you. Open a new conversation. Buy something cheap through Rye
   until `state=completed`. Confirm a `pilot_alerts` row did **not** appear.
2. Next calendar day, new conversation: the opening must name the thing you
   bought (the Percival moment). If it greets you as a stranger, purchase
   memory did not write — stop the ten-user invite.

## Prod env (must match eval)

| Knob | Eval |
|---|---|
| `FASHION_ROUTER_MODEL` | `claude-sonnet-5` |
| `FASHION_TASTE_RERANK_MODEL` | Haiku (`claude-haiku-4-5-20251001`) |
| `FASHION_CURATION_MODEL` | `claude-sonnet-5` |
| `SCORING_WEIGHTS_VERSION` | `v4-taste` |

Router prompt cache: Sonnet 5 floor is 1024 tokens; static router prefix
clears it. Confirm turn-2+ `cache_read_input_tokens` on `/api/health`
`prompt_cache.by_stage.router` (hit_rate not null).

Anthropic Console: monthly spend cap raised above the $500 Start floor, 80%
alert on. Eval gate: `EVAL_ORG_MONTHLY_SPEND_LIMIT_USD`.
