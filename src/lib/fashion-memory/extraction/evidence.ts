/** Normalize text for substring evidence checks. */
export function normalizeEvidenceText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function evidenceQuoteInMessages(
  quote: string,
  messageTexts: string[],
): boolean {
  const needle = normalizeEvidenceText(quote);
  if (!needle || needle.length < 2) return false;
  return messageTexts.some((msg) =>
    normalizeEvidenceText(msg).includes(needle),
  );
}

/** Extract body text from [NEW] tagged lines in the messages block. */
export function newMessageTextsFromContextBlock(messagesBlock: string): string[] {
  return messagesBlock
    .split("\n")
    .filter((line) => line.startsWith("[NEW]"))
    .map((line) => line.replace(/^\[NEW\]\s+(user|assistant):\s*/i, "").trim())
    .filter(Boolean);
}
