import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBlockingClarification,
  getGenderPresentation,
  needsDepartmentClarification,
  needsIntake,
  parseDepartmentAnswer,
  parseDepartmentFromMessage,
} from "./identity-gate";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow, PersonRow } from "../types";

const emptyPerson: PersonRow = {
  id: "p1",
  user_id: "u1",
  relation: "self",
  name: null,
  birthday: null,
  notes: null,
  intake_completed_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const weddingBrief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "wedding_guest",
  quantity_hint: "one outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Smart wedding guest look for Cyprus heat.",
};

describe("needsIntake", () => {
  it("requires intake on cold profile before first search", () => {
    assert.equal(
      needsIntake({ person: emptyPerson, facts: [], brief: weddingBrief }),
      true,
    );
  });

  it("still requires intake when framing was shown but sizes missing", () => {
    assert.equal(
      needsIntake({
        person: { ...emptyPerson, intake_completed_at: "2026-07-08T10:00:00Z" },
        facts: [],
        brief: weddingBrief,
      }),
      true,
    );
  });

  it("skips intake once gender and sizes are on profile", () => {
    assert.equal(
      needsIntake({
        person: { ...emptyPerson, intake_completed_at: "2026-07-08T10:00:00Z" },
        facts: [
          {
            id: "f1",
            user_id: "u1",
            person_id: "p1",
            fact_type: "gender_presentation",
            garment_type: null,
            value: { presentation: "mens" },
            source_quote: null,
            status: "active",
            superseded_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          } satisfies FashionFactRow,
          {
            id: "f2",
            user_id: "u1",
            person_id: "p1",
            fact_type: "size",
            garment_type: "tops",
            value: { system: "alpha", value: "M" },
            source_quote: null,
            status: "active",
            superseded_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          } satisfies FashionFactRow,
          {
            id: "f3",
            user_id: "u1",
            person_id: "p1",
            fact_type: "size",
            garment_type: "bottoms",
            value: { system: "us", value: 32 },
            source_quote: null,
            status: "active",
            superseded_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          } satisfies FashionFactRow,
          {
            id: "f4",
            user_id: "u1",
            person_id: "p1",
            fact_type: "size",
            garment_type: "shoes",
            value: { system: "us", value: 10 },
            source_quote: null,
            status: "active",
            superseded_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          } satisfies FashionFactRow,
        ],
        brief: weddingBrief,
      }),
      false,
    );
  });
});

describe("buildBlockingClarification", () => {
  it("asks department first then relevant sizes only", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [],
      targetPersonId: "p1",
    });
    const questions = blocking.questions;
    assert.equal(questions[0]?.field, "gender_presentation");
    assert.ok(questions.some((q) => q.field === "size_tops"));
    assert.ok(questions.some((q) => q.field === "size_bottoms"));
    assert.ok(questions.some((q) => q.field === "size_shoes"));
    assert.ok(questions.length <= 4);
  });

  it("skips gender when account profile already has presentation", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [],
      targetPersonId: "p1",
      profileHints: {
        genderPresentation: "mens",
        sizeBuckets: new Set(),
        preferredName: null,
        sizeLines: [],
      },
    });
    const questions = blocking.questions;
    assert.ok(!questions.some((q) => q.field === "gender_presentation"));
    assert.ok(questions.some((q) => q.field === "size_tops"));
  });

  it("skips gender when brief already has department_scope (gift recipient)", () => {
    const blocking = buildBlockingClarification({
      brief: { ...weddingBrief, department_scope: "womens" },
      facts: [],
      targetPersonId: "p1",
      personLabel: "mom",
    });
    const questions = blocking.questions;
    assert.ok(!questions.some((q) => q.field === "gender_presentation"));
    assert.ok(questions.some((q) => q.field === "size_tops"));
  });

  it("skips gender for mother/wife relations without asking Men's/Women's", () => {
    const blocking = buildBlockingClarification({
      brief: {
        ...weddingBrief,
        request_type: "single_item",
        garments: ["dress"],
      },
      facts: [],
      targetPersonId: "p1",
      personLabel: "mother",
      person: { relation: "mother" },
    });
    const questions = blocking.questions;
    assert.ok(!questions.some((q) => q.field === "gender_presentation"));
    assert.deepEqual(
      questions.map((q) => q.field),
      ["size_dresses"],
    );
  });

  it("still asks gender for ambiguous relations like friend", () => {
    const blocking = buildBlockingClarification({
      brief: {
        ...weddingBrief,
        request_type: "single_item",
        garments: ["dress"],
      },
      facts: [],
      targetPersonId: "p1",
      personLabel: "friend",
      person: { relation: "friend" },
    });
    assert.equal(blocking.questions[0]?.field, "gender_presentation");
  });

  it("names the recipient in the gender question for gifts", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [],
      targetPersonId: "p1",
      personLabel: "mom",
    });
    assert.match(
      blocking.questions.find((q) => q.field === "gender_presentation")?.text ?? "",
      /for mom/i,
    );
  });

  it("names the recipient in size questions for gifts", () => {
    const blocking = buildBlockingClarification({
      brief: {
        ...weddingBrief,
        request_type: "single_item",
        garments: ["dress"],
        department_scope: "womens",
      },
      facts: [],
      targetPersonId: "p1",
      personLabel: "mother",
    });
    const dressQ = blocking.questions.find((q) => q.field === "size_dresses");
    assert.match(dressQ?.text ?? "", /mother/i);
    assert.doesNotMatch(dressQ?.text ?? "", /\byou\b/i);
  });

  it("skips size buckets covered by account sizing profile", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [
        {
          id: "f1",
          user_id: "u1",
          person_id: "p1",
          fact_type: "gender_presentation",
          garment_type: null,
          value: { presentation: "mens" },
          source_quote: null,
          status: "active",
          superseded_by: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        } satisfies FashionFactRow,
      ],
      targetPersonId: "p1",
      profileHints: {
        genderPresentation: "mens",
        sizeBuckets: new Set(["tops", "bottoms", "shoes"]),
        preferredName: null,
        sizeLines: ["tops M (account)"],
      },
    });
    assert.ok(!blocking.questions.some((q) => q.field?.startsWith("size_")));
    assert.ok(!blocking.questions.some((q) => q.field === "gender_presentation"));
  });

  it("opens with essentials framing line", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [],
      targetPersonId: "p1",
    });
    assert.match(blocking.reply, /essentials|fits/i);
    assert.equal(blocking.target_person_id, "p1");
  });

  it("bundles department and size for cold cyprus wedding outfit", () => {
    const blocking = buildBlockingClarification({
      brief: weddingBrief,
      facts: [],
      targetPersonId: "p1",
      personLabel: "you",
      person: emptyPerson,
    });
    assert.equal(blocking.questions.some((q) => q.gap === "department"), true);
    assert.ok(blocking.questions.some((q) => q.gap === "size"));
    assert.ok(blocking.questions.length <= 4);
    assert.ok(blocking.questions.length >= 2);
  });
});

describe("department clarification", () => {
  it("parses quick option answers", () => {
    assert.equal(parseDepartmentAnswer("Men's"), "mens");
    assert.equal(parseDepartmentAnswer("Mix it"), "mixed");
  });

  it("parses department from batched intake replies", () => {
    assert.equal(
      parseDepartmentFromMessage(
        "What department should I shop — men's, women's, or mix it up? Men's. What's your top size? M.",
      ),
      "mens",
    );
    assert.equal(
      parseDepartmentFromMessage("Which section should I shop for you? Women's. Fit preference? Regular"),
      "womens",
    );
  });

  it("fires when outfit still lacks department", () => {
    assert.equal(
      needsDepartmentClarification({
        brief: weddingBrief,
        facts: [],
        person: emptyPerson,
      }),
      true,
    );
    assert.equal(
      needsDepartmentClarification({
        brief: { ...weddingBrief, department_scope: "mens" },
        facts: [],
        person: emptyPerson,
      }),
      false,
    );
    assert.equal(
      getGenderPresentation([
        {
          id: "f1",
          user_id: "u1",
          person_id: "p1",
          fact_type: "gender_presentation",
          garment_type: null,
          value: { presentation: "mens" },
          source_quote: null,
          status: "active",
          superseded_by: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        } satisfies FashionFactRow,
      ]),
      "mens",
    );
  });
});
