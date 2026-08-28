import { canonicalGarmentFamily } from "../eval/garment-family";
import { fashionFactValuesEqual } from "../facts";
import { normalizeSignalValue } from "../signals";
import {
  formatPersonKey,
  labelKey,
  personKey,
} from "./names";
import type {
  CaseDiff,
  DumpedFact,
  DumpedSignal,
  MemoryCase,
  StoreDump,
} from "./types";

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

export function canonicalSignalValue(
  signalType: string,
  value: string,
): string {
  const raw = normalizeSignalValue(value);
  if (signalType === "garment") {
    return canonicalGarmentFamily(raw) ?? raw;
  }
  return raw;
}

function factKey(row: {
  person: string;
  fact_type: string;
  garment_type?: string | null;
  value: unknown;
}): string {
  const garment = row.garment_type?.trim().toLowerCase() || "";
  return `${labelKey(row.person)}|${row.fact_type}|${garment}|${stableJson(row.value)}`;
}

function signalKey(row: {
  person: string;
  signal_type: string;
  value: string;
  polarity: 1 | -1;
}): string {
  return `${labelKey(row.person)}|${row.signal_type}|${canonicalSignalValue(row.signal_type, row.value)}|${row.polarity}`;
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (fashionFactValuesEqual(expected, actual)) return true;
  if (
    expected &&
    actual &&
    typeof expected === "object" &&
    typeof actual === "object"
  ) {
    return stableJson(expected) === stableJson(actual);
  }
  return expected === actual;
}

function findFact(
  facts: DumpedFact[],
  expected: {
    person: string;
    fact_type: string;
    garment_type?: string;
    value: unknown;
  },
): DumpedFact | undefined {
  const wantKey = labelKey(expected.person);
  const garment = expected.garment_type?.trim().toLowerCase() || "";
  return facts.find((f) => {
    if (labelKey(f.person) !== wantKey) return false;
    if (f.fact_type !== expected.fact_type) return false;
    const fg = f.garment_type?.trim().toLowerCase() || "";
    if (fg !== garment) return false;
    return valuesMatch(expected.value, f.value);
  });
}

function findSignal(
  signals: DumpedSignal[],
  expected: {
    person: string;
    signal_type: string;
    value: string;
    polarity: 1 | -1;
  },
): DumpedSignal | undefined {
  const want = signalKey(expected);
  return signals.find(
    (s) =>
      signalKey({
        person: s.person,
        signal_type: s.signal_type,
        value: s.value,
        polarity: s.polarity,
      }) === want,
  );
}

function distinctiveTokens(value: unknown): string[] {
  const generic = new Set([
    "cm",
    "in",
    "eu",
    "us",
    "uk",
    "alpha",
    "waist_inseam",
    "system",
    "value",
    "kind",
    "unit",
    "count",
    "looks",
    "options",
    "metric",
    "presentation",
    "fit",
    "material",
    "style",
    "color",
    "garment",
  ]);
  const tokens: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      tokens.push(`n:${v}`);
      return;
    }
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t && !generic.has(t)) tokens.push(`s:${t}`);
      return;
    }
    if (v && typeof v === "object") {
      for (const child of Object.values(v as Record<string, unknown>)) {
        walk(child);
      }
    }
  };
  walk(value);
  return tokens;
}

function valuesCrossMatch(expected: unknown, actual: unknown): boolean {
  if (valuesMatch(expected, actual)) return true;
  const want = distinctiveTokens(expected);
  if (!want.length) return false;
  const have = new Set(distinctiveTokens(actual));
  return want.some((t) => have.has(t));
}

function otherPersonFact(
  facts: DumpedFact[],
  expected: {
    person: string;
    fact_type: string;
    garment_type?: string;
    value: unknown;
  },
): DumpedFact | undefined {
  const wantKey = labelKey(expected.person);
  return facts.find((f) => {
    if (labelKey(f.person) === wantKey) return false;
    return valuesCrossMatch(expected.value, f.value);
  });
}

function otherPersonSignal(
  signals: DumpedSignal[],
  expected: {
    person: string;
    signal_type: string;
    value: string;
    polarity: 1 | -1;
  },
): DumpedSignal | undefined {
  const canon = canonicalSignalValue(expected.signal_type, expected.value);
  const wantPerson = labelKey(expected.person);
  return signals.find((s) => {
    if (labelKey(s.person) === wantPerson) return false;
    if (s.signal_type !== expected.signal_type) return false;
    if (s.polarity !== expected.polarity) return false;
    return canonicalSignalValue(s.signal_type, s.value) === canon;
  });
}

function forbiddenHit(
  dump: StoreDump,
  rule: MemoryCase["expect"]["forbidden"][number],
): string | null {
  const person = labelKey(rule.person);
  if (rule.fact_type) {
    const hit = dump.facts.find((f) => {
      if (labelKey(f.person) !== person) return false;
      if (f.fact_type !== rule.fact_type) return false;
      if (rule.value == null) return true;
      if (valuesMatch(rule.value, f.value)) return true;
      if (typeof rule.value === "string") {
        const want = rule.value.trim().toLowerCase();
        const tokens = distinctiveTokens(f.value);
        return (
          tokens.includes(`s:${want}`) ||
          (Number.isFinite(Number(want)) && tokens.includes(`n:${Number(want)}`))
        );
      }
      return valuesCrossMatch(rule.value, f.value);
    });
    if (hit) {
      return `forbidden fact ${rule.person} ${rule.fact_type} ${stableJson(hit.value)}`;
    }
  }
  if (rule.signal_type) {
    const hit = dump.signals.find((s) => {
      if (labelKey(s.person) !== person) return false;
      if (s.signal_type !== rule.signal_type) return false;
      if (rule.value != null) {
        const canon = canonicalSignalValue(s.signal_type, s.value);
        const want = canonicalSignalValue(rule.signal_type, rule.value);
        if (canon !== want) return false;
      }
      return true;
    });
    if (hit) {
      return `forbidden signal ${rule.person} ${rule.signal_type}=${hit.value}`;
    }
  }
  if (!rule.fact_type && !rule.signal_type && rule.value) {
    const factHit = dump.facts.find(
      (f) =>
        labelKey(f.person) === person &&
        JSON.stringify(f.value).toLowerCase().includes(rule.value!.toLowerCase()),
    );
    if (factHit) return `forbidden value on fact ${rule.person}`;
    const sigHit = dump.signals.find((s) => {
      if (labelKey(s.person) !== person) return false;
      return canonicalSignalValue(s.signal_type, s.value) ===
        canonicalSignalValue(s.signal_type, rule.value!);
    });
    if (sigHit) return `forbidden value on signal ${rule.person}`;
  }
  return null;
}

export function diffDump(params: {
  cse: MemoryCase;
  dump: StoreDump;
}): CaseDiff {
  const { cse, dump } = params;
  const missing: string[] = [];
  const extra: string[] = [];
  const forbidden: string[] = [];
  const wrong_person: string[] = [];
  const status_mismatch: string[] = [];

  const expectPeople = cse.expect.people.length
    ? cse.expect.people
    : [{ relation: "self" }];
  const expectKeys = new Set(
    expectPeople.map((p) => personKey(p.relation, p.name)),
  );
  const actualByKey = new Map<string, number>();
  for (const p of dump.people) {
    const k = personKey(p.relation, p.name);
    actualByKey.set(k, (actualByKey.get(k) ?? 0) + 1);
  }

  for (const p of expectPeople) {
    const k = personKey(p.relation, p.name);
    if (!actualByKey.has(k)) {
      missing.push(`person ${formatPersonKey(p.relation, p.name)}`);
    }
  }
  for (const p of dump.people) {
    const k = personKey(p.relation, p.name);
    if (!expectKeys.has(k)) {
      extra.push(`person ${formatPersonKey(p.relation, p.name)}`);
    }
  }
  for (const [k, n] of actualByKey) {
    if (n > 1) extra.push(`person duplicate ${k} x${n}`);
  }

  const matchedFactKeys = new Set<string>();
  for (const exp of cse.expect.facts) {
    const hit = findFact(dump.facts, exp);
    if (!hit) {
      const crossed = otherPersonFact(dump.facts, exp);
      if (crossed) {
        wrong_person.push(
          `fact ${exp.fact_type} ${stableJson(exp.value)} expected ${exp.person} wrote ${crossed.person}`,
        );
      } else {
        missing.push(
          `fact ${exp.person} ${exp.fact_type}${exp.garment_type ? `/${exp.garment_type}` : ""} ${stableJson(exp.value)} status=${exp.status}`,
        );
      }
      continue;
    }
    matchedFactKeys.add(factKey(hit));
    if (hit.status !== exp.status) {
      status_mismatch.push(
        `fact ${exp.person} ${exp.fact_type} status ${hit.status}≠${exp.status}`,
      );
    }
  }

  const matchedSignalKeys = new Set<string>();
  for (const exp of cse.expect.signals) {
    const hit = findSignal(dump.signals, exp);
    if (!hit) {
      const crossed = otherPersonSignal(dump.signals, exp);
      if (crossed) {
        wrong_person.push(
          `signal ${exp.signal_type}=${exp.value} expected ${exp.person} wrote ${crossed.person}`,
        );
      } else {
        missing.push(
          `signal ${exp.person} ${exp.signal_type}=${exp.value} ${exp.polarity} ${exp.source} status=${exp.status}`,
        );
      }
      continue;
    }
    matchedSignalKeys.add(signalKey(hit));
    if (hit.status !== exp.status) {
      status_mismatch.push(
        `signal ${exp.person} ${exp.signal_type}=${exp.value} status ${hit.status}≠${exp.status}`,
      );
    }
    if (exp.source && hit.source !== exp.source) {
      status_mismatch.push(
        `signal ${exp.person} ${exp.signal_type}=${exp.value} source ${hit.source}≠${exp.source}`,
      );
    }
    if (exp.context && hit.context !== exp.context) {
      status_mismatch.push(
        `signal ${exp.person} ${exp.signal_type}=${exp.value} context ${hit.context}≠${exp.context}`,
      );
    }
    if (
      exp.confidence != null &&
      Math.abs(hit.confidence - exp.confidence) > 0.06
    ) {
      status_mismatch.push(
        `signal ${exp.person} ${exp.signal_type}=${exp.value} confidence ${hit.confidence}≠${exp.confidence}`,
      );
    }
  }

  for (const f of dump.facts) {
    const k = factKey(f);
    if (matchedFactKeys.has(k)) continue;
    extra.push(
      `fact ${f.person} ${f.fact_type}${f.garment_type ? `/${f.garment_type}` : ""} ${stableJson(f.value)} status=${f.status}`,
    );
  }
  for (const s of dump.signals) {
    const k = signalKey(s);
    if (matchedSignalKeys.has(k)) continue;
    extra.push(
      `signal ${s.person} ${s.signal_type}=${s.value} ${s.polarity} ${s.source} status=${s.status}`,
    );
  }

  for (const rule of cse.expect.forbidden) {
    const hit = forbiddenHit(dump, rule);
    if (hit) forbidden.push(hit);
  }

  const ambiguous =
    cse.expect.ambiguous_subjects != null
      ? {
          expected: cse.expect.ambiguous_subjects,
          actual: dump.ambiguous_subjects,
        }
      : undefined;
  if (
    ambiguous &&
    ambiguous.expected !== ambiguous.actual
  ) {
    missing.push(
      `ambiguous_subjects expected ${ambiguous.expected} got ${ambiguous.actual}`,
    );
  }

  const next_router_asks: string[] = [];
  if (cse.expect.next_router_asks?.length) {
    for (const exp of cse.expect.next_router_asks) {
      const actual = dump.next_router_asks.filter((a) => a.gap === exp.gap);
      if (!actual.length) {
        next_router_asks.push(`missing ${exp.gap} ask`);
        continue;
      }
      const chips = actual.flatMap((a) => a.chips);
      for (const want of exp.chips_include) {
        const hit = chips.some(
          (c) => c === want || c.includes(want) || want.includes(c),
        );
        if (!hit) {
          next_router_asks.push(
            `chips missing ${want} (had ${chips.join(", ") || "none"})`,
          );
        }
      }
    }
  }

  const request_events: string[] = [];
  for (const exp of cse.expect.request_events ?? []) {
    const count = dump.request_events.filter(
      (e) => labelKey(e.person) === labelKey(exp.person),
    ).length;
    if (count !== exp.count) {
      request_events.push(
        `request_events ${exp.person} expected ${exp.count} got ${count}`,
      );
    }
  }

  const recent_picks: string[] = [];
  if (cse.expect.recent_picks_prefers_purchase) {
    const line = dump.recent_picks_line ?? "";
    if (!/bought|purchase/i.test(line)) {
      recent_picks.push(
        `recent_picks missing purchase preference: ${line || "(empty)"}`,
      );
    }
  }

  return {
    missing: [...missing, ...status_mismatch],
    extra,
    forbidden,
    wrong_person,
    status_mismatch,
    ambiguous_subjects: ambiguous,
    next_router_asks,
    request_events,
    recent_picks,
  };
}

export function casePassed(diff: CaseDiff): boolean {
  const extraPeople = diff.extra.filter((e) => e.startsWith("person "));
  return (
    diff.missing.length === 0 &&
    diff.forbidden.length === 0 &&
    diff.wrong_person.length === 0 &&
    extraPeople.length === 0 &&
    (diff.next_router_asks?.length ?? 0) === 0 &&
    (diff.request_events?.length ?? 0) === 0 &&
    (diff.recent_picks?.length ?? 0) === 0
  );
}

export function expectedItemCount(cse: MemoryCase): number {
  return (
    cse.expect.people.length +
    cse.expect.facts.length +
    cse.expect.signals.length
  );
}
