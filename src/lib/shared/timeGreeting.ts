export function extractFirstName(preferredName?: string | null): string | null {
  const trimmed = preferredName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export function getTimeBasedGreeting(date: Date = new Date()): {
  prefix: string;
  fullPhrase: string;
} {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return { prefix: "Good morning", fullPhrase: "Good morning" };
  }
  if (hour >= 12 && hour < 17) {
    return { prefix: "Good afternoon", fullPhrase: "Good afternoon" };
  }
  if (hour >= 17 && hour < 22) {
    return { prefix: "Good evening", fullPhrase: "Good evening" };
  }
  return { prefix: "Late night", fullPhrase: "Late night" };
}

export function buildGreeting(
  preferredName?: string | null,
  date: Date = new Date(),
): string {
  const { fullPhrase } = getTimeBasedGreeting(date);
  const first = extractFirstName(preferredName);
  if (first) {
    return `${fullPhrase}, ${first}.`;
  }
  return `${fullPhrase}.`;
}
