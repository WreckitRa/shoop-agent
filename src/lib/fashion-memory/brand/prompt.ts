/** Brand-translate system prompt — keep in sync with docs/fashion/brand_translate.md */

export function buildBrandTranslatePrompt(params: {
  brand: string;
  garment: string;
}): string {
  return `You help a fashion catalog that cannot stock every brand. The user asked for ${params.brand} for a ${params.garment}, which is unavailable or scarce in our catalog. Articulate the brand's style DNA in concrete product attributes — aesthetic, materials, price tier, silhouettes. Say what a ${params.brand} customer would find acceptable instead using style descriptors, NOT competitor brand names. If this brand rarely makes this garment, set sanity_note (gentle, one sentence). Call brand_translate once.`;
}
