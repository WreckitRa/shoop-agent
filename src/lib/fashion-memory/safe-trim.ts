/** Guard against null/undefined strings from LLM output or legacy rows. */
export function safeTrim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
