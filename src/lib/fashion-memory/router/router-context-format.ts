import { filterSignalsByEffectiveConfidence } from "../signal-confidence";
import { safeTrim } from "../safe-trim";
import type {
  FashionFactRow,
  FashionFactBudgetBandValue,
  FashionFactSizeValue,
  PersonRow,
  StyleSignalRow,
} from "../types";
import {
  buildPersonShortIdMap,
  formatRosterBlock,
  formatRosterLine,
  personMentionedInText,
  selectSnapshotPersonIds,
} from "../extraction/context-format";

const MAX_ROUTER_SIGNALS = 8;

function formatSizeCompact(fact: FashionFactRow): string | null {
  if (fact.fact_type !== "size") return null;
  const value = fact.value as FashionFactSizeValue;
  const garment = fact.garment_type?.trim() || "general";
  const v = value.value;
  if (typeof v === "object" && v !== null && "waist" in v) {
    return `${garment} W${v.waist}x${v.inseam}`;
  }
  if (value.system === "eu") return `${garment} EU${v}`;
  if (value.system === "us") return `${garment} US${v}`;
  if (value.system === "uk") return `${garment} UK${v}`;
  return `${garment} ${String(v)}`;
}

function formatFitCompact(fact: FashionFactRow): string | null {
  if (fact.fact_type !== "fit") return null;
  const garment = fact.garment_type?.trim() || "general";
  const fit = (fact.value as { fit?: string }).fit ?? "unknown";
  return `${garment} ${fit}`;
}

function formatNoGoCompact(fact: FashionFactRow): string | null {
  if (fact.fact_type !== "no_go") return null;
  return (fact.value as { value?: string }).value ?? null;
}

function formatBudgetHint(fact: FashionFactRow): string | null {
  if (fact.fact_type !== "budget_band") return null;
  const band = fact.value as FashionFactBudgetBandValue;
  const garment = fact.garment_type?.trim() || "general";
  if (band.min != null && band.min > 0) {
    return `${garment} ${band.currency} ${band.min}-${band.max} (stated)`;
  }
  return `${garment} ≤ ${band.currency}${band.max} (stated)`;
}

function formatRouterSignalToken(signal: StyleSignalRow): string {
  const sign = signal.polarity === -1 ? "-" : "+";
  return `${sign}${signal.value} [${signal.context}, ${signal.source}]`;
}

function formatGenderPresentation(fact: FashionFactRow): string | null {
  if (fact.fact_type !== "gender_presentation") return null;
  const presentation = (fact.value as { presentation?: string }).presentation;
  if (!presentation) return null;
  if (presentation === "mens") return "shop men's";
  if (presentation === "womens") return "shop women's";
  if (presentation === "boys") return "shop boys'";
  if (presentation === "girls") return "shop girls'";
  if (presentation === "baby") return "shop baby";
  return "shop mixed departments";
}

export type RouterAccountHints = {
  genderPresentation?: "mens" | "womens" | "mixed" | null;
  preferredName?: string | null;
  sizeLines?: string[];
};

export function formatRouterPersonProfile(params: {
  person: PersonRow;
  facts: FashionFactRow[];
  signals: StyleSignalRow[];
  shortIds: Record<string, string>;
  now?: Date;
  /** Account onboarding — merged into self profile when fashion_facts are thin. */
  accountHints?: RouterAccountHints | null;
}): string {
  const displayPerson =
    params.person.relation === "self" &&
    !params.person.name?.trim() &&
    params.accountHints?.preferredName
      ? { ...params.person, name: params.accountHints.preferredName }
      : params.person;

  const header = `## ${formatRosterLine(displayPerson, params.shortIds)}`;
  const factSizes = params.facts
    .filter((f) => f.fact_type === "size")
    .map(formatSizeCompact)
    .filter(Boolean) as string[];
  const accountSizes =
    params.person.relation === "self" ? (params.accountHints?.sizeLines ?? []) : [];
  const sizes = [...factSizes];
  for (const line of accountSizes) {
    if (!sizes.includes(line)) sizes.push(line);
  }
  const fits = params.facts
    .filter((f) => f.fact_type === "fit")
    .map(formatFitCompact)
    .filter(Boolean);
  const noGos = params.facts
    .filter((f) => f.fact_type === "no_go")
    .map(formatNoGoCompact)
    .filter(Boolean);
  const budgets = params.facts
    .filter((f) => f.fact_type === "budget_band")
    .map(formatBudgetHint)
    .filter(Boolean);
  const department = params.facts
    .filter((f) => f.fact_type === "gender_presentation")
    .map(formatGenderPresentation)
    .filter(Boolean) as string[];
  if (
    !department.length &&
    params.person.relation === "self" &&
    params.accountHints?.genderPresentation
  ) {
    const g = params.accountHints.genderPresentation;
    department.push(
      g === "mens"
        ? "shop men's"
        : g === "womens"
          ? "shop women's"
          : "shop mixed departments",
    );
  }

  const topSignals = filterSignalsByEffectiveConfidence(
    params.signals,
    undefined,
    params.now,
  )
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.last_seen_at.localeCompare(a.last_seen_at),
    )
    .slice(0, MAX_ROUTER_SIGNALS);

  const lines: string[] = [header];
  if (department.length) lines.push(`department: ${department.join(", ")}`);
  if (sizes.length) lines.push(`sizes: ${sizes.join(", ")}`);
  if (fits.length) lines.push(`fit: ${fits.join(", ")}`);
  if (noGos.length) lines.push(`no_gos: ${noGos.join(", ")}`);
  if (budgets.length) lines.push(`budget_hints: ${budgets.join(", ")}`);
  if (topSignals.length) {
    lines.push(
      `signals: ${topSignals.map(formatRouterSignalToken).join(" | ")}`,
    );
  }
  if (lines.length === 1) {
    lines.push("(no recorded facts or signals yet)");
  }
  return lines.join("\n");
}

export function buildRouterContextFromData(params: {
  people: PersonRow[];
  factsByPersonId: Map<string, FashionFactRow[]>;
  signalsByPersonId: Map<string, StyleSignalRow[]>;
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>;
  stickyPersonIds: string[];
  now?: Date;
  accountHints?: RouterAccountHints | null;
}): import("./types").FashionRouterContext {
  const peopleForDisplay = params.people.map((person) => {
    if (
      person.relation === "self" &&
      !person.name?.trim() &&
      params.accountHints?.preferredName
    ) {
      return { ...person, name: params.accountHints.preferredName };
    }
    return person;
  });
  const personShortIds = buildPersonShortIdMap(peopleForDisplay);
  const roster = formatRosterBlock(peopleForDisplay, personShortIds);
  const messageWindowText = params.conversationMessages
    .map((m) => m.content)
    .join("\n");
  const profilePersonIds = selectSnapshotPersonIds({
    people: peopleForDisplay,
    messageWindowText,
    stickyPersonIds: params.stickyPersonIds,
  });

  const profiles = profilePersonIds
    .map((personId) => {
      const person = peopleForDisplay.find((p) => p.id === personId);
      if (!person) return null;
      return formatRouterPersonProfile({
        person,
        facts: params.factsByPersonId.get(personId) ?? [],
        signals: params.signalsByPersonId.get(personId) ?? [],
        shortIds: personShortIds,
        now: params.now,
        accountHints:
          person.relation === "self" ? params.accountHints : null,
      });
    })
    .filter(Boolean)
    .join("\n\n");

  const now = params.now ?? new Date();
  return {
    roster,
    profiles: profiles || "(no profile snapshots for this turn)",
    currentDate: now.toISOString().slice(0, 10),
    personShortIds,
    conversationMessages: params.conversationMessages,
  };
}

export { personMentionedInText, buildPersonShortIdMap, formatRosterLine };
