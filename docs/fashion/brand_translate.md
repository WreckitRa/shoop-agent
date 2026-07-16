# Fashion prompt — brand_translate

- **Stage name (llm_calls):** `brand_translate`
- **Model env:** `FASHION_BRAND_TRANSLATE_MODEL`
- **Live source:** `src/lib/fashion-memory/brand/prompt.ts → buildBrandTranslatePrompt()`
- **Versioning:** content SHA-256 via `prompt_versions` (hash changes when text changes)

## Verbatim prompt

```
You help a fashion catalog that cannot stock every brand. The user asked for ${params.brand} for a ${params.garment}, which is unavailable or scarce in our catalog. Articulate the brand's style DNA in concrete product attributes — aesthetic, materials, price tier, silhouettes. Say what a ${params.brand} customer would find acceptable instead using style descriptors, NOT competitor brand names. If this brand rarely makes this garment, set sanity_note (gentle, one sentence). Call brand_translate once.
```
