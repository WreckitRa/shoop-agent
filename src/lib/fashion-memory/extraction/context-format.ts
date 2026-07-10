import { filterSignalsByEffectiveConfidence } from "../signal-confidence";
import { safeTrim } from "../safe-trim";
import type {
  FashionFactRow,
  FashionFactSizeValue,
  PersonRow,
  StyleSignalRow,
} from "../types";
import type { FashionTurnMessage } from "./message-window";

export type FashionExtractionContext = {
  /** Block A — one line per person (#abcd relation (Name)). */
  roster: string;
  /** Block B — compact fact/signal snapshots for relevant people. */
  snapshots: string;
  /** Block C — last 10 messages tagged [CONTEXT] or [NEW]. */
  messages: string;
  /** Block D — ISO date for birthday/occasion reasoning. */
  currentDate: string;
  /** Short id (e.g. a1b2) → full person UUID for op resolution. */
  personShortIds: Record<string, string>;
};

const MAX_SIGNALS_PER_PERSON = 10;

export const RELATION_SCAN_TERMS = [
  "brother",
  "mom",
  "mother",
  "dad",
  "father",
  "wife",
  "husband",
  "girlfriend",
  "boyfriend",
  "sister",
  "son",
  "daughter",
  "friend",
  "colleague",
] as const;

export function personShortId(personId: string): string {
  return personId.replace(/-/g, "").slice(0, 4).toLowerCase();
}

export function buildPersonShortIdMap(
  people: PersonRow[],
): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();

  for (const person of people) {
    let short = personShortId(person.id);
    if (used.has(short)) {
      short = person.id.replace(/-/g, "").slice(0, 6).toLowerCase();
    }
    used.add(short);
    map[short] = person.id;
  }

  return map;
}

export function formatRosterLine(
  person: PersonRow,
  shortIds: Record<string, string>,
): string {
  const short =
    Object.entries(shortIds).find(([, id]) => id === person.id)?.[0] ??
    personShortId(person.id);
  const relation = safeTrim(person.relation) || "unknown";
  const name = person.name?.trim();
  return name
    ? `#${short} ${relation} (${name})`
    : `#${short} ${relation}`;
}

export function formatRosterBlock(
  people: PersonRow[],
  shortIds: Record<string, string>,
): string {
  if (!people.length) return "(no people registered)";
  return people.map((p) => formatRosterLine(p, shortIds)).join("\n");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordMatch(haystack: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRegex(needle)}\\b`, "i").test(haystack);
}

const RELATION_ALIASES: Record<string, readonly string[]> = {
  mother: ["mom", "mother"],
  father: ["dad", "father"],
};

function relationNeedles(relation: string): string[] {
  const rel = relation.toLowerCase().trim();
  if (!rel) return [];
  const needles = new Set<string>([rel]);
  for (const alias of RELATION_ALIASES[rel] ?? []) needles.add(alias);
  for (const [canonical, aliases] of Object.entries(RELATION_ALIASES)) {
    if (aliases.includes(rel)) {
      needles.add(canonical);
      for (const alias of aliases) needles.add(alias);
    }
  }
  return [...needles];
}

export function personMentionedInText(person: PersonRow, text: string): boolean {
  if (person.relation !== "self") {
    for (const needle of relationNeedles(person.relation)) {
      if (wordMatch(text, needle)) return true;
    }
  }

  const name = person.name?.trim();
  if (name && wordMatch(text, name)) return true;

  return false;
}

export function selectSnapshotPersonIds(params: {
  people: PersonRow[];
  messageWindowText: string;
  stickyPersonIds: string[];
}): string[] {
  const selected = new Set<string>();

  const self = params.people.find((p) => p.relation === "self");
  if (self) selected.add(self.id);

  for (const person of params.people) {
    if (personMentionedInText(person, params.messageWindowText)) {
      selected.add(person.id);
    }
  }

  for (const id of params.stickyPersonIds) {
    selected.add(id);
  }

  return params.people
    .filter((p) => selected.has(p.id))
    .map((p) => p.id);
}

function formatSizeValue(value: FashionFactSizeValue): string {
  const v = value.value;
  if (typeof v === "object" && v !== null && "waist" in v) {
    return `${v.waist}x${v.inseam}`;
  }
  if (value.system === "eu") {
    return `EU${v}`;
  }
  if (value.system === "us") {
    return `US${v}`;
  }
  if (value.system === "uk") {
    return `UK${v}`;
  }
  return String(v);
}

function garmentLabel(garmentType: string | null): string {
  return garmentType?.trim() || "general";
}

function formatFactLine(fact: FashionFactRow): string | null {
  switch (fact.fact_type) {
    case "size": {
      const value = fact.value as FashionFactSizeValue;
      return `${garmentLabel(fact.garment_type)} ${formatSizeValue(value)} (stated)`;
    }
    case "fit": {
      const fit = (fact.value as { fit?: string }).fit ?? "unknown";
      return `${garmentLabel(fact.garment_type)} ${fit} (stated)`;
    }
    case "no_go": {
      const noGo = fact.value as { value?: string };
      return `${noGo.value ?? "unknown"} (stated)`;
    }
    case "budget_band": {
      const band = fact.value as {
        min: number | null;
        max: number;
        currency: string;
      };
      const min = band.min != null ? band.min : 0;
      return `${band.currency} ${min}-${band.max} (stated)`;
    }
    case "body_note":
      return null;
    default:
      return null;
  }
}

function formatSignalToken(signal: StyleSignalRow): string {
  const sign = signal.polarity === -1 ? "-" : "+";
  const conf = signal.confidence.toFixed(1).replace(/\.0$/, "");
  return `${sign}${signal.value} [${signal.context}, ${signal.source}, ${conf}]`;
}

export function formatPersonSnapshot(params: {
  person: PersonRow;
  facts: FashionFactRow[];
  signals: StyleSignalRow[];
  shortIds: Record<string, string>;
}): string {
  const header = `## ${formatRosterLine(params.person, params.shortIds)}`;

  const sizeLines = params.facts
    .filter((f) => f.fact_type === "size")
    .map(formatFactLine)
    .filter(Boolean);
  const fitLines = params.facts
    .filter((f) => f.fact_type === "fit")
    .map(formatFactLine)
    .filter(Boolean);
  const noGoLines = params.facts
    .filter((f) => f.fact_type === "no_go")
    .map(formatFactLine)
    .filter(Boolean);
  const budgetLines = params.facts
    .filter((f) => f.fact_type === "budget_band")
    .map(formatFactLine)
    .filter(Boolean);

  const topSignals = filterSignalsByEffectiveConfidence(params.signals)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.last_seen_at.localeCompare(a.last_seen_at),
    )
    .slice(0, MAX_SIGNALS_PER_PERSON);

  const lines: string[] = [header];
  if (sizeLines.length) lines.push(`sizes: ${sizeLines.join(", ")}`);
  if (fitLines.length) lines.push(`fit: ${fitLines.join(", ")}`);
  if (noGoLines.length) lines.push(`no_gos: ${noGoLines.join(", ")}`);
  if (budgetLines.length) lines.push(`budget: ${budgetLines.join(", ")}`);
  if (topSignals.length) {
    lines.push(`signals: ${topSignals.map(formatSignalToken).join(" | ")}`);
  }
  if (lines.length === 1) {
    lines.push("(no recorded facts or signals yet)");
  }

  return lines.join("\n");
}

export function buildExtractionContextFromData(params: {
  people: PersonRow[];
  factsByPersonId: Map<string, FashionFactRow[]>;
  signalsByPersonId: Map<string, StyleSignalRow[]>;
  recentMessages: FashionTurnMessage[];
  watermarkMessageId: string | null;
  watermarkCreatedAt: Date | null;
  stickyPersonIds: string[];
  now?: Date;
}): FashionExtractionContext {
  const personShortIds = buildPersonShortIdMap(params.people);
  const roster = formatRosterBlock(params.people, personShortIds);
  const messageWindowText = params.recentMessages.map((m) => m.content).join("\n");
  const snapshotPersonIds = selectSnapshotPersonIds({
    people: params.people,
    messageWindowText,
    stickyPersonIds: params.stickyPersonIds,
  });

  const snapshots = snapshotPersonIds
    .map((personId) => {
      const person = params.people.find((p) => p.id === personId);
      if (!person) return null;
      return formatPersonSnapshot({
        person,
        facts: params.factsByPersonId.get(personId) ?? [],
        signals: params.signalsByPersonId.get(personId) ?? [],
        shortIds: personShortIds,
      });
    })
    .filter(Boolean)
    .join("\n\n");

  const messages = formatMessageWindowBlock({
    messages: params.recentMessages,
    watermarkMessageId: params.watermarkMessageId,
    watermarkCreatedAt: params.watermarkCreatedAt,
  });

  const now = params.now ?? new Date();
  return {
    roster,
    snapshots,
    messages,
    currentDate: now.toISOString().slice(0, 10),
    personShortIds,
  };
}

export function isMessageAfterWatermark(
  message: Pick<FashionTurnMessage, "id" | "createdAt">,
  watermark: Pick<FashionTurnMessage, "id" | "createdAt"> | null,
): boolean {
  if (!watermark) return true;
  if (message.createdAt > watermark.createdAt) return true;
  if (message.createdAt < watermark.createdAt) return false;
  return message.id > watermark.id;
}

export function formatMessageWindowBlock(params: {
  messages: FashionTurnMessage[];
  watermarkMessageId: string | null;
  watermarkCreatedAt: Date | null;
}): string {
  if (!params.messages.length) return "(no messages)";

  const watermark =
    params.watermarkMessageId && params.watermarkCreatedAt
      ? { id: params.watermarkMessageId, createdAt: params.watermarkCreatedAt }
      : null;

  return params.messages
    .map((msg) => {
      const tag = isMessageAfterWatermark(msg, watermark) ? "NEW" : "CONTEXT";
      const role = msg.role === "user" ? "user" : "assistant";
      const content = safeTrim(msg.content) || "(empty)";
      return `[${tag}] ${role}: ${content}`;
    })
    .join("\n");
}
