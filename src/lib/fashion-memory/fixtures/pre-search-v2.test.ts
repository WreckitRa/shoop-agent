/**
 * Pre-Search Chat Run v2 fixtures — PROFILES rendering, personalization,
 * prompt-cache breakpoints, voice tone, deterministic gate path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeAspiresLine,
  composeContextLine,
  formatLastSearchLine,
  honestyToneLine,
  inferOccasionFromLifestyle,
  mapHonestyToVoice,
  parseOnboardingMetaFromFacts,
  rankSignalsForRouter,
} from "../router/profile-context-format";
import { formatRouterPersonProfile } from "../router/router-context-format";
import {
  buildFashionRouterSystemParts,
  ROUTER_PROMPT_STATIC,
} from "../router/prompt";
import { buildCachedSystemBlocks } from "../observability/traced-llm-call";
import {
  promptCacheSnapshot,
  resetPromptCacheForTests,
} from "../observability/prompt-cache-metrics";
import {
  personalizedColorOptions,
  personalizedStyleOptions,
} from "../router/clarification-defaults";
import { voiceToneAppendix } from "../curation/voice";
import type {
  FashionFactRow,
  PersonRow,
  RequestEventRow,
  StyleSignalRow,
} from "../types";

function person(partial: Partial<PersonRow> & { id: string }): PersonRow {
  return {
    user_id: "u1",
    relation: "self",
    name: "Raph",
    intake_completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function bodyNoteFact(value: Record<string, unknown>): FashionFactRow {
  return {
    id: "f1",
    user_id: "u1",
    person_id: "p1",
    fact_type: "body_note",
    garment_type: "onboarding-meta",
    value,
    source_quote: "onboarding:profile-meta",
    status: "active",
    superseded_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function signal(
  partial: Partial<StyleSignalRow> & { value: string },
): StyleSignalRow {
  return {
    id: "s1",
    user_id: "u1",
    person_id: "p1",
    context: "general",
    signal_type: "style",
    polarity: 1,
    source: "stated",
    confidence: 0.8,
    evidence_count: 1,
    status: "active",
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-07-01T00:00:00Z",
    source_quote: null,
    ...partial,
  };
}

describe("context_line_renders", () => {
  it("renders context/tone/aspires for onboarded self", () => {
    const meta = parseOnboardingMetaFromFacts([
      bodyNoteFact({
        age_range: "25-34",
        style_era: "30s",
        lifestyle_tags: ["deep_in_career"],
        value_philosophy: "luxury",
        honesty_preference: "straight",
        compliment_preferences: ["Effortless", "Put-together"],
      }),
    ]);
    assert.ok(meta);
    const context = composeContextLine(meta!);
    assert.ok(context?.includes("context:"));
    assert.ok(context?.includes("deep in career"));
    assert.ok(context?.includes("quiet-luxury") || context?.includes("spender"));
    assert.equal(honestyToneLine("straight"), 'tone: honesty balanced ("give it to me straight")');
    assert.ok(composeAspiresLine(meta!)?.includes("effortless"));

    const profile = formatRouterPersonProfile({
      person: person({ id: "p1" }),
      facts: [
        bodyNoteFact({
          age_range: "25-34",
          style_era: "30s",
          lifestyle_tags: ["deep_in_career"],
          value_philosophy: "luxury",
          honesty_preference: "straight",
          compliment_preferences: ["Effortless", "Put-together"],
        }),
      ],
      signals: [],
      shortIds: { a1: "p1" },
    });
    assert.ok(profile.includes("context:"));
    assert.ok(profile.includes("tone:"));
    assert.ok(profile.includes("aspires:"));
  });

  it("renders CSV week, weekends, and climate in the context line", () => {
    const context = composeContextLine({
      age_range: "25-34",
      style_era: "30s",
      week_is: "working_mixed,studying",
      weekends_are: "friends,nightlife",
      kids: "young",
      climate: "hot_humid,four_seasons",
    });
    assert.ok(context?.includes("mix of home and office"));
    assert.ok(context?.includes("studying"));
    assert.ok(context?.includes("out with friends"));
    assert.ok(context?.includes("nightlife"));
    assert.ok(context?.includes("young kids"));
    assert.ok(context?.includes("hot and humid"));
    assert.ok(context?.includes("four seasons"));
  });

  it("omits context lines when onboarding meta absent", () => {
    const profile = formatRouterPersonProfile({
      person: person({ id: "p1" }),
      facts: [],
      signals: [],
      shortIds: { a1: "p1" },
    });
    assert.equal(profile.includes("context:"), false);
    assert.equal(profile.includes("tone:"), false);
    assert.equal(profile.includes("aspires:"), false);
  });
});

describe("occasion_inferred_from_lifestyle", () => {
  it("maps deep_in_career → work", () => {
    const inferred = inferOccasionFromLifestyle(["deep_in_career"]);
    assert.equal(inferred?.occasion, "work");
    assert.ok(inferred?.framing.includes("office"));
  });

  it("returns null for cold profile", () => {
    assert.equal(inferOccasionFromLifestyle([]), null);
    assert.equal(inferOccasionFromLifestyle(undefined), null);
  });
});

describe("signals_ranked_by_occasion", () => {
  it("prefers event/elevated contexts for wedding hint", () => {
    const ranked = rankSignalsForRouter({
      signals: [
        signal({
          id: "gym",
          value: "athletic",
          context: "gym",
          confidence: 0.95,
        }),
        signal({
          id: "elev",
          value: "tailored",
          context: "elevated",
          confidence: 0.7,
        }),
        signal({
          id: "event",
          value: "formal",
          context: "event",
          confidence: 0.7,
        }),
      ],
      occasionHint: "event",
      limit: 2,
    });
    assert.equal(ranked[0]?.context === "gym", false);
    assert.ok(
      ranked.some((s) => s.context === "elevated" || s.context === "event"),
    );
  });

  it("excludes candidate signals from PROFILES ranking", () => {
    const ranked = rankSignalsForRouter({
      signals: [
        signal({
          id: "stripe",
          value: "striped",
          signal_type: "pattern",
          polarity: -1,
          status: "candidate",
          confidence: 0.4,
        }),
        signal({
          id: "navy",
          value: "navy",
          signal_type: "color",
          polarity: 1,
          status: "active",
          confidence: 0.9,
        }),
      ],
      limit: 8,
    });
    assert.equal(
      ranked.some((s) => /strip/i.test(s.value)),
      false,
    );
    assert.equal(ranked[0]?.value, "navy");
  });
});

describe("continuity_resolves", () => {
  it("formats last_search within 14 days", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const event: RequestEventRow = {
      id: "e1",
      user_id: "u1",
      person_id: "p1",
      conversation_id: "c1",
      attributes: { garment: "navy linen shirt", occasion: "work" },
      created_at: "2026-07-28T12:00:00Z",
    };
    const line = formatLastSearchLine({
      event,
      personRelation: "self",
      now,
    });
    assert.ok(line?.startsWith("last_search:"));
    assert.ok(line?.includes("navy linen shirt"));
    assert.ok(line?.includes("work"));
  });
});

describe("prompt_cache_breakpoint", () => {
  it("keeps PROFILES outside the cached system block", () => {
    const uniqueProfile = "## Raph (self) #a1\ncontext: UNIQUE_PROFILE_MARKER_ZZ9";
    const parts = buildFashionRouterSystemParts({
      roster: "ROSTER: Raph (self) #a1",
      profiles: uniqueProfile,
      currentDate: "2026-07-30",
    });
    assert.ok(parts.cachedPrefix.includes("You are Shoop"));
    assert.equal(parts.cachedPrefix.includes("UNIQUE_PROFILE_MARKER_ZZ9"), false);
    assert.equal(parts.cachedPrefix.includes("{ROSTER}"), false);
    assert.ok(parts.uncachedSuffix.includes("UNIQUE_PROFILE_MARKER_ZZ9"));
    assert.ok(parts.uncachedSuffix.includes("--- CONTEXT ---"));

    const blocks = buildCachedSystemBlocks({
      cachedPrefix: ROUTER_PROMPT_STATIC,
      uncachedSuffix: parts.uncachedSuffix,
    });
    assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[0]?.text.includes("UNIQUE_PROFILE_MARKER_ZZ9"), false);
    assert.equal(blocks[1]?.cache_control, undefined);
    assert.ok(blocks[1]?.text.includes("UNIQUE_PROFILE_MARKER_ZZ9"));
  });

  it("marks under-threshold stages as n/a (hit_rate null), not broken zeros", () => {
    resetPromptCacheForTests();
    const snap = promptCacheSnapshot();
    assert.equal(snap.by_stage.planner?.expected_cacheable, false);
    assert.equal(snap.by_stage.planner?.hit_rate, null);
    assert.equal(snap.by_stage.normalize_llm?.hit_rate, null);
    assert.equal(snap.by_stage.extraction?.hit_rate, null);
    assert.equal(snap.by_stage.curation_voice?.hit_rate, null);
    assert.equal(snap.by_stage.router?.expected_cacheable, true);
    assert.equal(snap.by_stage.curation?.expected_cacheable, true);
  });
});

describe("personalized_clarification_options", () => {
  it("warm profile gets taste-derived style chips", () => {
    const opts = personalizedStyleOptions({
      signals: [
        { signal_type: "style", value: "minimal", polarity: 1 },
        { signal_type: "color", value: "olive", polarity: 1 },
        { signal_type: "aesthetic", value: "quiet luxury", polarity: 1 },
      ],
      departmentLabel: "men's",
    });
    assert.ok(opts);
    const labels = opts!.map((o) => o.label.toLowerCase());
    assert.ok(labels.some((l) => l.includes("minimal")));
    assert.ok(opts!.some((o) => o.previewQuery?.includes("minimal")));
    assert.ok(labels.includes("surprise me"));
  });

  it("cold profile returns null (generic fallback)", () => {
    assert.equal(
      personalizedStyleOptions({ signals: [] }),
      null,
    );
    assert.equal(
      personalizedColorOptions({ signals: [] }),
      null,
    );
  });

  it("color options draw from positive color signals", () => {
    const opts = personalizedColorOptions({
      signals: [{ signal_type: "color", value: "olive", polarity: 1 }],
    });
    assert.ok(opts?.some((o) => /olive/i.test(o.label)));
  });
});

describe("voice_context_threads", () => {
  it("maps honesty modes and omits philosophy for gift recipient semantics", () => {
    assert.equal(mapHonestyToVoice("no_mercy"), "blunt");
    assert.equal(mapHonestyToVoice("gentle"), "gentle");
    assert.equal(mapHonestyToVoice("straight"), "balanced");
    const blunt = voiceToneAppendix({ honesty: "blunt" });
    const gentle = voiceToneAppendix({ honesty: "gentle" });
    assert.ok(blunt.includes("BLUNT"));
    assert.ok(gentle.includes("GENTLE"));
    assert.notEqual(blunt, gentle);
  });
});
