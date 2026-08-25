/**
 * Consultation fixtures. Assert on tool-call SHAPE, never on prose.
 * Router calls hit the live model (same harness as joe/swimwear fixtures).
 * Helper `runRouter(turns, ctx)` returns the single tool call.
 */
import { describe, it, expect } from "vitest";
import { runRouter, profileFixture, emptyProfile } from "./harness";
import {
  onClarification,
  mayAutoUpgradeToSearch,
  buildAppointmentContext,
  resetAppointment,
  MAX_CONSULT_ROUNDS,
} from "../intake/consultation";
import { agreedDepth, missingAssumptionLines } from "../curation/appointment-contract";

const alex = profileFixture({
  name: "Alex",
  department: "mens",
  sizes: { tops: "M", bottoms: "W32x30", shoes: "EU44" },
  signals: ["+navy [work, stated]", "+slim [global, stated]", "-logos [global, stated]"],
  context: "30s · deep in career",
});

describe("A. vague ask, known client → one consult turn", () => {
  it("asks ≤3 questions, opens with known_summary, every consult q has You decide, escape chip set", async () => {
    const call = await runRouter([{ user: "need some shirts" }], alex);
    expect(call.name).toBe("ask_clarification");
    expect(call.input.known_summary).toBeTruthy();
    expect(call.input.known_summary).toMatch(/M|navy|slim/i);
    expect(call.input.questions.length).toBeLessThanOrEqual(3);
    const consult = call.input.questions.filter((q: any) => q.kind === "consult");
    expect(consult.length).toBeGreaterThan(0);
    // it must NOT ask anything in profile
    for (const q of call.input.questions) expect(["size", "department"]).not.toContain(q.gap);
    // depth or preference_anchor should be among the consults for this ask
    expect(consult.map((q: any) => q.gap)).toEqual(expect.arrayContaining([expect.stringMatching(/depth|preference_anchor/)]));
    const fixed = onClarification(call.input, resetAppointment(), "en");
    for (const q of fixed.call.questions.filter((q) => q.kind === "consult"))
      expect(q.quick_options.map((o) => (typeof o === "string" ? o : o.label))).toContain("You decide");
    expect(fixed.call.escape_chip).toBeTruthy();
    expect(fixed.call.brief?.garments).toContain("shirt");
  });
});

describe("B. speed signal → search with declared assumptions (EN/FR/AR)", () => {
  for (const msg of ["you know me, just go", "vas-y, tu me connais", "يلا انت بتعرفني"]) {
    it(`"${msg}"`, async () => {
      const call = await runRouter(
        [
          { user: "need some shirts" },
          { assistant_clarification: { questions: [{ gap: "depth", kind: "consult" }, { gap: "preference_anchor", kind: "consult" }] } },
          { user: msg },
        ],
        alex,
      );
      expect(call.name).toBe("ready_to_search");
      expect(call.input.brief.assumptions.length).toBeGreaterThanOrEqual(1);
      expect(["you_decide", "assumed"]).toContain(call.input.brief.depth.source);
      expect(call.input.brief.depth.options_per_item).toBeGreaterThan(0);
    });
  }
});

describe("C. greeting is first contact, never off-topic", () => {
  it("hey → ask_clarification gap:garment with world chips", async () => {
    const call = await runRouter([{ user: "hey" }], { ...alex, last_search: "wedding guest outfit, 2026-08-20" });
    expect(call.name).toBe("ask_clarification");
    expect(call.input.questions).toHaveLength(1);
    expect(call.input.questions[0].gap).toBe("garment");
    expect(call.input.questions[0].quick_options.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(call.input)).toMatch(/wedding/i);
  });
});

describe("D. complete brief → zero questions (regression guard)", () => {
  it("full formal outfit for Joe … 3 looks", async () => {
    const call = await runRouter(
      [{ user: "full formal outfit for Joe, under $100, Men's, M tops, 33 bottoms, shoes 10, business event, 3 looks" }],
      emptyProfile(),
    );
    expect(call.name).toBe("ready_to_search");
    expect(call.input.brief.depth).toMatchObject({ looks_wanted: 3, source: "stated" });
    expect(call.input.brief.request_type).toBe("outfit");
    expect(call.input.brief.stated_facts?.new_person?.name).toBe("Joe");
  });
});

describe("E. consultation budget cap in code", () => {
  it("third consult turn is stripped and context says budget spent", () => {
    let appt = resetAppointment({ recipient_person_id: "self", garments: ["shirt"] });
    const consultCall = {
      reply: "x",
      questions: [{ gap: "depth", kind: "consult", text: "?", quick_options: ["3", "5"] }],
      brief: { recipient_person_id: "self", garments: ["shirt"] },
    } as any;
    for (let i = 0; i < MAX_CONSULT_ROUNDS; i++) appt = onClarification(consultCall, appt).appt;
    expect(buildAppointmentContext(appt)).toMatch(/BUDGET SPENT/);
    const third = onClarification({ ...consultCall, questions: [{ ...consultCall.questions[0], gap: "color" }] }, appt);
    expect(third.call.questions).toHaveLength(0);
    expect(third.appt.rounds_used).toBe(MAX_CONSULT_ROUNDS);
  });

  it("blocking questions do not consume budget; auto-upgrade only for blocking-only turns", () => {
    const appt = resetAppointment({ recipient_person_id: "self", garments: ["shoes"] });
    const blockingCall = { reply: "x", questions: [{ gap: "size", kind: "blocking", text: "?", quick_options: ["42", "43"] }] } as any;
    expect(onClarification(blockingCall, appt).appt.rounds_used).toBe(0);
    expect(mayAutoUpgradeToSearch(blockingCall, () => true)).toBe(true);
    const mixed = { ...blockingCall, questions: [...blockingCall.questions, { gap: "depth", kind: "consult", text: "?", quick_options: ["3"] }] };
    expect(mayAutoUpgradeToSearch(mixed, () => true)).toBe(false);
  });
});

describe("F. planner depth precedence + explore palette", () => {
  it("stated 3 looks → anchor gets 3; explore never uses profile palette", async () => {
    const { runPlanner } = await import("./harness");
    const plan = await runPlanner({
      request_type: "outfit",
      garments: ["shirt", "trousers", "shoes"],
      depth: { looks_wanted: 3, source: "stated" },
      preference_anchor: "explore",
      color_direction: { source: "profile" },
      occasion_context: "office",
      style_direction: "step out of navy on purpose",
    } as any, alex);
    const anchor = plan.slots.find((s: any) => s.role === "anchor");
    expect(anchor.options_wanted).toBe(3);
    for (const s of plan.slots) {
      expect(s.options_wanted).toBeGreaterThanOrEqual(2);
      expect(s.palette_source).not.toBe("profile");
    }
  });
});

describe("G. curation voices every assumption", () => {
  it("missingAssumptionLines catches drops", () => {
    const brief = { assumptions: ["Assumed the office", "Went with 4 options"] } as any;
    expect(missingAssumptionLines(brief, { assumption_lines: ["Assumed the office"] })).toEqual([1]);
    expect(missingAssumptionLines(brief, { assumption_lines: ["a", "b"] })).toEqual([]);
  });
  it("agreedDepth reads the brief", () => {
    expect(agreedDepth({ request_type: "single_item", depth: { options_per_item: 5, source: "stated" } } as any).picks).toBe(5);
    expect(agreedDepth({ request_type: "capsule", depth: { looks_wanted: 6, source: "you_decide" } } as any).looks).toBe(6);
  });
});

describe("H. refinement never consults", () => {
  it("'same but blue' after results → ready_to_search, no questions", async () => {
    const call = await runRouter(
      [{ user: "3 white shirts for work" }, { assistant_results: { garments: ["shirt"] } }, { user: "same but blue" }],
      alex,
    );
    expect(call.name).toBe("ready_to_search");
    expect(call.input.brief.color_direction.source).toBe("stated");
    expect(call.input.brief.depth).toMatchObject({ options_per_item: 3, source: "stated" });
  });
});

describe("I. quick shopper skips consults", () => {
  it("shopping_style quick → search or blocking-only", async () => {
    const call = await runRouter([{ user: "need some shirts" }], { ...alex, extra_lines: ["shopping_style: quick [global, inferred]", "depth_default: 4 options (stated)"] });
    if (call.name === "ask_clarification")
      expect(call.input.questions.every((q: any) => q.kind === "blocking")).toBe(true);
    else expect(call.input.brief.depth).toMatchObject({ options_per_item: 4, source: "stated" });
  });
});
