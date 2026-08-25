/**
 * Adds two lines to the per-person PROFILES block so the router can adapt:
 *
 *   shopping_style: quick [inferred]        (or guided)
 *   depth_default: 5 options (stated)
 *
 * Drop-in for assemble-router-context.ts's profile formatter. No special
 * handling elsewhere — the router prompt reads these like any other fact.
 *
 * Also exports the extraction-gate tweak: chip taps that resolve a consult
 * question ("You decide", escape chip) count as soliciting-answer turns so
 * the clerk sees them and can infer shopping_style over time.
 */

export interface StyleSignalRow {
  category: string;
  value: string;
  polarity: number;
  source: "stated" | "inferred";
  context?: string | null;
}
export interface FactRow {
  fact_type: string;
  value: any;
  source: "stated" | "inferred";
}

export function formatAppointmentLines(signals: StyleSignalRow[], facts: FactRow[]): string[] {
  const out: string[] = [];
  const style = signals
    .filter((s) => s.category === "shopping_style" && s.polarity > 0)
    .sort((a, b) => (a.source === "stated" ? -1 : 1) - (b.source === "stated" ? -1 : 1))[0];
  if (style) {
    out.push(
      `shopping_style: ${style.value} [${style.context ?? "global"}, ${style.source}]`,
    );
  }
  const depth = facts.find((f) => f.fact_type === "depth_default");
  if (depth?.value?.value && depth.value.unit) {
    out.push(`depth_default: ${depth.value.value} ${depth.value.unit} (${depth.source})`);
  }
  return out;
}

/**
 * extraction/gate.ts: previously "short acks only extract when the previous
 * assistant turn was soliciting". Extend the soliciting predicate so that a
 * turn whose metadata carries ask_clarification with any kind:"consult"
 * question is soliciting. Then a tapped "You decide" is a [NEW] message the
 * clerk can count toward shopping_style.
 */
export function assistantTurnWasSoliciting(meta: any): boolean {
  const q = meta?.fashionRouter?.clarification?.questions;
  return Array.isArray(q) && q.length > 0;
}
