/** Stable look id for capsule outfit try-on (matches run-outfit resolver). */
export function capsuleLookId(index: number, label?: string): string {
  const key = label?.trim() || String(index);
  return `capsule:${encodeURIComponent(key)}`;
}

export function parseCapsuleLookId(
  lookId: string,
): { kind: "capsule"; key: string } | { kind: "look" } {
  if (lookId.startsWith("capsule:")) {
    return {
      kind: "capsule",
      key: decodeURIComponent(lookId.slice("capsule:".length)),
    };
  }
  return { kind: "look" };
}
