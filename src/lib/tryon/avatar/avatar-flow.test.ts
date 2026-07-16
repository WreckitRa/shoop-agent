import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildFashnAvatarPrompt,
  TRYON_AVATAR_PROMPT_VERSION,
} from "../avatar/fashn-prompt";
import {
  classifyAvatarPhotoKind,
  runAvatarIntake,
  setAvatarIntakeOverride,
  setAvatarVisionSuggestOverride,
} from "../avatar/intake";
import { FashionLocalStore, emptyGuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import { applyLocalFashionOps } from "@/lib/fashion-memory/local/apply-local-fashion-ops";
import {
  adminMeasurementSummary,
  redactFactsForAdmin,
} from "@/lib/fashion-memory/admin-fact-privacy";
import { fashionFactMeasurementValueSchema } from "@/lib/fashion-memory/extraction/fact-value-schemas";
import { buildFashionExtractionPrompt } from "@/lib/fashion-memory/extraction/prompt";
import { buildPersonShortIdMap } from "@/lib/fashion-memory/extraction/context-format";
import type { FashionFactRow, PersonRow } from "@/lib/fashion-memory/types";

describe("avatar prompt v2 — body_shape + bust", () => {
  it("bumps prompt version", () => {
    assert.equal(TRYON_AVATAR_PROMPT_VERSION, "v2");
  });

  it("Tailored: triangle + full bust maps to visual phrases", () => {
    const prompt = buildFashnAvatarPrompt({
      height_band: "170_180",
      build: "average",
      muscularity: "moderate",
      body_shape: "triangle",
      bust_fullness: "full",
    });
    assert.match(prompt ?? "", /fuller hips relative to shoulders/);
    assert.match(prompt ?? "", /full bust/);
    assert.match(prompt ?? "", /no beautification/);
  });

  it("Quick essentials: no body_shape / bust phrases", () => {
    const prompt = buildFashnAvatarPrompt({
      height_band: "170_180",
      build: "average",
      muscularity: "moderate",
    });
    assert.doesNotMatch(prompt ?? "", /fuller hips|full bust|balanced proportions|broader shoulders/);
    assert.match(prompt ?? "", /no beautification/);
  });
});

describe("avatar intake — vision pre-fill", () => {
  afterEach(() => {
    setAvatarIntakeOverride(null);
    setAvatarVisionSuggestOverride(null);
  });

  it("classifies full-body vs face-only from URL markers", () => {
    assert.equal(classifyAvatarPhotoKind("https://x/fullbody.jpg"), "full_body");
    assert.equal(classifyAvatarPhotoKind("https://x/faceonly-selfie.jpg"), "face_only");
  });

  it("full-body mock pre-selects body_shape (editable suggestion)", async () => {
    const result = await runAvatarIntake({
      photoSignedUrl: "https://cdn.example/mock-fullbody-triangle.png",
    });
    assert.equal(result.body_inference_attempted, true);
    assert.equal(result.clear.body_shape, "triangle");
    assert.equal(result.minor_refused, false);
  });

  it("face-only mock never attempts body inference", async () => {
    const result = await runAvatarIntake({
      photoSignedUrl: "https://cdn.example/faceonly-selfie.png",
    });
    assert.equal(result.body_inference_attempted, false);
    assert.equal(result.clear.body_shape, undefined);
  });
});

describe("measurement facts — tailored accordion + extraction", () => {
  it("schema accepts measurement value shape", () => {
    const v = fashionFactMeasurementValueSchema.parse({
      metric: "waist",
      value: 84,
      unit: "cm",
    });
    assert.equal(v.metric, "waist");
  });

  it("extraction prompt documents measurement fact shape", () => {
    assert.match(buildFashionExtractionPrompt(), /measurement/);
    assert.match(buildFashionExtractionPrompt(), /84cm|waist/i);
  });

  it("skip accordion → zero measurement facts; three fields → three facts", () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.createPerson({
      userId: "u1",
      relation: "self",
      name: null,
    });

    // Fully skipped
    assert.equal(
      store.snapshot.fashion_facts.filter((f) => f.fact_type === "measurement")
        .length,
      0,
    );

    const three = [
      { metric: "neck" as const, value: 38, unit: "cm" as const },
      { metric: "waist" as const, value: 84, unit: "cm" as const },
      { metric: "hips" as const, value: 96, unit: "cm" as const },
    ];
    for (const m of three) {
      store.upsertFashionFact({
        userId: "u1",
        personId: person.id,
        factType: "measurement",
        garmentType: m.metric,
        value: m,
        sourceQuote: `avatar tailored: ${m.metric}`,
      });
    }
    const active = store.snapshot.fashion_facts.filter(
      (f) => f.fact_type === "measurement" && f.status === "active",
    );
    assert.equal(active.length, 3);
    assert.deepEqual(
      active.map((f) => (f.value as { unit: string }).unit),
      ["cm", "cm", "cm"],
    );
  });

  it('"my waist is 84cm" extraction writes measurement with supersede', () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.createPerson({
      userId: "u1",
      relation: "self",
      name: null,
    });
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const shortRef = Object.keys(shortIds)[0]!;

    store.upsertFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "measurement",
      garmentType: "waist",
      value: { metric: "waist", value: 80, unit: "cm" },
      sourceQuote: "was 80",
    });

    const results = applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["my waist is 84cm now"],
      ops: [
        {
          op: "fact_add",
          person_ref: shortRef,
          source: "stated",
          confidence: 0.95,
          evidence_quote: "my waist is 84cm now",
          fact_type: "measurement",
          garment_type: "waist",
          value: { metric: "waist", value: 84, unit: "cm" },
        },
      ],
    });

    assert.equal(results[0]?.accepted, true);
    const active = store.findActiveFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "measurement",
      garmentType: "waist",
    });
    assert.equal((active?.value as { value: number }).value, 84);
    const superseded = store.snapshot.fashion_facts.filter(
      (f) =>
        f.fact_type === "measurement" &&
        f.garment_type === "waist" &&
        f.status === "superseded",
    );
    assert.equal(superseded.length, 1);
  });

  it("hard-delete purges measurement facts; admin shows count only", () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.createPerson({
      userId: "u1",
      relation: "self",
      name: null,
    });
    store.upsertFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "measurement",
      garmentType: "waist",
      value: { metric: "waist", value: 84, unit: "cm" },
    });
    store.upsertFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "size",
      garmentType: "tops",
      value: { system: "alpha", value: "M" },
    });

    const before = adminMeasurementSummary(store.snapshot.fashion_facts);
    assert.equal(before.measurements_on_file, 1);

    const redacted = redactFactsForAdmin(store.snapshot.fashion_facts);
    assert.equal(redacted.measurements_on_file, 1);
    assert.ok(
      redacted.facts.every((f) => f.fact_type !== "measurement"),
      "admin must not receive measurement values",
    );

    const purged = store.purgeMeasurementFacts({
      userId: "u1",
      personId: person.id,
    });
    assert.equal(purged, 1);
    assert.equal(
      store.snapshot.fashion_facts.filter((f) => f.fact_type === "measurement")
        .length,
      0,
    );
    // size fact remains
    assert.ok(
      store.snapshot.fashion_facts.some((f) => f.fact_type === "size"),
    );
  });
});

describe("admin privacy types compile", () => {
  it("empty facts → zero count", () => {
    const facts: FashionFactRow[] = [];
    assert.equal(adminMeasurementSummary(facts).measurements_on_file, 0);
  });
});
