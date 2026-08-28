# Fashion memory eval

Deterministic: scripted conversation → the real clerk (`extractFashionMemoryFromTurn`
+ `applyFashionOps` / `applyLocalFashionOps`) and the real sync-write paths
(`ensureMentionedPeople`, `applyClarificationReplyFromMessage`,
`writeRequestEventFromBrief`, `writeInteractionSignal`) → diff Store A against
an expected state. **No judge.**

```bash
npm run eval:memory
npm run eval:memory -- --store supabase
npm run eval:memory -- --store local
npm run eval:memory -- --store both --case iso-01
npm run eval:memory -- --case id-03,claim-02
```

`--store` defaults to `both`. Each case runs against a scratch user (Supabase
UUID, or `guest-{uuid}` + `FashionLocalStore`). Interaction cases (`iso-03` /
`iso-04`) are skipped on the local store (guests do not write rail signals).
Purchase cases run on both stores.

Each case runs once. A fail with no wrong-person / forbidden violation retries
once on a fresh session: pass on retry counts as a flake pass; two identical
fails is a real fail. Wrong-person and forbidden never retry.

Report: per-case clerk ops (accepted / rejected + reason), missing /
unexpected / forbidden / wrong-person, flake rate, plus four aggregate rates.
Wrong-person and forbidden must be 0. Artifacts land in `eval-memory/runs/<timestamp>/`.
