/** Deterministic placeholder when LLM swatch resolution is pending or failed. */
export function swatchColorFallbackFromLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 35% 65%)`;
}
