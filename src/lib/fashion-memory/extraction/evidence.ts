/** Normalize text for substring evidence checks. */
export function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u201C\u201D\u2018\u2019\u00AB\u00BB"']/g, "")
    .replace(/^\[tap\]\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceQuoteInMessages(
  quote: string,
  messageTexts: string[],
): boolean {
  const needle = normalizeEvidenceText(quote);
  if (!needle || needle.length < 2) return false;
  return messageTexts.some((msg) => {
    const hay = normalizeEvidenceText(msg);
    if (hay.includes(needle)) return true;
    const tap = /^\[tap\]\s/i.test(msg);
    return tap && hay.length >= 2 && needle.includes(hay);
  });
}

/** Extract body text from [NEW] tagged lines in the messages block. */
export function newMessageTextsFromContextBlock(messagesBlock: string): string[] {
  return messagesBlock
    .split("\n")
    .filter((line) => line.startsWith("[NEW]"))
    .map((line) => {
      const tap = /^\[NEW\]\s+\[tap\]\s+/i.test(line);
      const body = line
        .replace(/^\[NEW\]\s+(?:\[tap\]\s+)?(user|assistant):\s*/i, "")
        .trim();
      if (!body) return "";
      return tap ? `[tap] ${body}` : body;
    })
    .filter(Boolean);
}
