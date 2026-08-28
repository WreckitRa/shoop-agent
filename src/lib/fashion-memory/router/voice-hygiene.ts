/**
 * Recognized/voice hygiene — ban scripted lines, require client-word overlap,
 * keep known_summary concrete without log-speak.
 */

export const BANNED_STYLIST_LINES = [
  "Going on what I know — the usual, or something new?",
  "What should I pull for this?",
  "20 seconds of essentials so everything I pull actually fits — and I only ask once.",
  "Quick sizing so everything I pull actually fits.",
  "Happy to help! What's the occasion you're shopping for?",
  "Happy to help — what's the occasion you're shopping for?",
  "One quick thing so I pull right.",
  "Got it. One quick thing so I pull the right pieces.",
] as const;

const BANNED_NORM = new Set(
  BANNED_STYLIST_LINES.map((s) => normalizeLine(s)),
);

export function normalizeLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBannedStylistLine(reply: string | null | undefined): boolean {
  const n = normalizeLine(reply ?? "");
  if (!n) return false;
  if (BANNED_NORM.has(n)) return true;
  // Prefix match for slight punctuation drift
  for (const ban of BANNED_NORM) {
    if (n.startsWith(ban.slice(0, Math.min(40, ban.length)))) return true;
  }
  return false;
}

/** Concrete fact required when known_summary is present. */
export function knownSummaryPassesTemplate(
  knownSummary: string | null | undefined,
): boolean {
  const ks = knownSummary?.trim() ?? "";
  if (!ks) return true; // omit ok
  if (/^going on what i know\.?$/i.test(ks)) return false;
  // Pure log dump "Going on: a, b, c." without warmth — fail template
  if (/^going on:\s*[^.]+\.?$/i.test(ks) && !/\blast time|usually|you\b/i.test(ks)) {
    return false;
  }
  const concrete =
    /\b(size|tops?|bottoms?|shoes?|dresses?|mens|womens|navy|tailored|[LMSX]{1,3}|\d{2}|blazer|shirt|dress|jean|coat|last time|usually|lean|shop)\b/i;
  return concrete.test(ks);
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "for",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "my",
  "me",
  "i",
  "im",
  "i'm",
  "need",
  "looking",
  "help",
  "something",
  "show",
  "size",
  "please",
  "with",
  "this",
  "that",
  "some",
  "any",
  "just",
  "want",
  "get",
]);

/** Content words from the client's last message (garment/occasion nouns). */
export function clientContentTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** Reply shares ≥1 content token with the client's last message. */
export function replyUsesClientWords(params: {
  reply: string;
  lastUser: string;
}): boolean {
  const tokens = clientContentTokens(params.lastUser);
  if (!tokens.length) return true;
  const blob = params.reply.toLowerCase();
  return tokens.some((t) => t.length >= 4 && blob.includes(t));
}

/**
 * Client-facing search confirmation / pull_line — never a bare garment list.
 * Prefer garments/occasion that appear in the client's words. ≤20 words.
 */
export function buildPullLine(params: {
  lastUser: string;
  garments?: string[];
  occasion?: string | null;
  depthLooks?: number | null;
  sizeHint?: string | null;
  pickHint?: string | null;
}): string {
  const user = params.lastUser.trim();
  const enthusiasm =
    /^(ooh|hmm|nice|let me see|show me|just show|go ahead)\b/i.test(user) ||
    /let me see what you'?ve got/i.test(user);
  const userLower = enthusiasm ? "" : user.toLowerCase();
  const garments = (params.garments ?? [])
    .map((g) => g.trim())
    .filter(Boolean)
    .filter((g) => !/^(ooh|hmm|nice|let me see)/i.test(g))
    .slice(0, 3);
  const inClient = userLower
    ? garments.filter((g) =>
        userLower.includes(g.toLowerCase().split(/\s+/)[0] ?? g.toLowerCase()),
      )
    : [];
  const piece =
    (inClient.length ? inClient : garments).join(", ") ||
    (enthusiasm
      ? ""
      : clientContentTokens(user)
          .filter((t) =>
            /\b(shirt|dress|jean|trouser|blazer|sneaker|shoe|skirt|blouse|sweater|jacket|coat|tee|top|suit)\b/i.test(
              t,
            ),
          )
          .slice(0, 3)
          .join(", "));
  const occasion =
    params.occasion?.trim() ||
    (enthusiasm
      ? null
      : (/\b(interview|wedding|baptism|date|brunch|commute|beach|office|dinner|trip|vacation)\b/i.exec(
          user,
        )?.[1] ?? null));
  const depth =
    params.depthLooks != null && params.depthLooks > 0
      ? `${params.depthLooks} options`
      : null;
  const size = params.sizeHint?.trim() || null;

  const bits: string[] = [];
  if (piece && occasion) bits.push(`${piece} for ${occasion}`);
  else if (piece) bits.push(piece);
  else if (occasion) bits.push(`for ${occasion}`);
  else {
    const tokens = enthusiasm ? [] : clientContentTokens(user);
    if (tokens.length) bits.push(tokens.slice(0, 4).join(" "));
  }
  if (size) bits.push(`size ${size}`);
  if (depth) bits.push(depth);

  const touches = [
    "on it",
    "shopping that now",
    "taking that to the rack",
    "pulling a few options",
  ];
  // Stable but varied touch from content — avoid one scripted closer.
  const touch =
    touches[
      Math.abs(
        (piece || occasion || bits.join(" ") || "x")
          .split("")
          .reduce((a, c) => a + c.charCodeAt(0), 0),
      ) % touches.length
    ]!;

  let line = bits.length
    ? `${bits.join(", ")} — ${touch}.`
    : `${touch[0]!.toUpperCase()}${touch.slice(1)}.`;
  if (params.pickHint) {
    line = `${line.replace(/\.$/, "")} (not the ${params.pickHint} lane unless you say so).`;
  }
  return clampWords(line, 20);
}

/** @deprecated Prefer buildPullLine — kept for call sites / tests. */
export function buildSpokenSearchReply(params: {
  lastUser: string;
  garments?: string[];
  occasion?: string | null;
  pickHint?: string | null;
}): string {
  return buildPullLine(params);
}

function clampWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[.,;:—-]+$/, "")}.`;
}

/** Warm known_summary with concrete facts — not a bare "Going on: a, b." dump. */
export function formatKnownSummarySpeech(params: {
  department?: string | null;
  garments?: string[];
  sizeLines?: string[];
  pickHint?: string | null;
}): string | undefined {
  const dept = params.department?.trim() || null;
  const sizes = (params.sizeLines ?? []).slice(0, 2).filter(Boolean);
  const garments = (params.garments ?? []).slice(0, 3).filter(Boolean);
  const bits: string[] = [];
  if (dept) bits.push(`you shop ${dept}`);
  if (sizes.length) bits.push(sizes.join(", "));
  if (garments.length) bits.push(garments.join(", "));
  if (!bits.length && !params.pickHint) return undefined;
  const base = bits.length
    ? `I know ${bits.join(" · ")}`
    : "I know your lane";
  return params.pickHint
    ? `${base} — last time you took ${params.pickHint}.`
    : `${base}.`;
}
