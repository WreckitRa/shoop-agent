import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardTextFromProfile, VERDICT_EVAL_PROFILES } from "./profiles";
import { runVerdictCardChecks } from "./checks";
import { buildSeedPayload, EVAL_VERDICT_SEED_SPECS } from "./prisma-seed";

describe("verdict eval fixtures", () => {
  it("covers male/female × minimal/bold × photo/no-photo on six profiles", () => {
    assert.equal(VERDICT_EVAL_PROFILES.length, 6);
    assert.ok(VERDICT_EVAL_PROFILES.some((p) => p.gender === "male" && p.photo));
    assert.ok(VERDICT_EVAL_PROFILES.some((p) => p.gender === "female" && p.photo));
    assert.ok(VERDICT_EVAL_PROFILES.some((p) => p.taste === "bold"));
    assert.ok(VERDICT_EVAL_PROFILES.some((p) => !p.photo));
  });

  it("every seeded card passes deterministic checks", () => {
    for (const profile of VERDICT_EVAL_PROFILES) {
      const { view } = cardTextFromProfile(profile);
      const checks = runVerdictCardChecks(view);
      const failed = checks.filter((c) => !c.ok).map((c) => c.id);
      assert.deepEqual(failed, [], profile.id);
    }
  });

  it("Prisma seed specs map weekends, veto notes, and brand reasons into the J4 payload", () => {
    assert.equal(EVAL_VERDICT_SEED_SPECS.length, 6);
    for (const spec of EVAL_VERDICT_SEED_SPECS) {
      const payload = buildSeedPayload(spec);
      const lifestyle = payload.questionnaireAnswers.lifestyle as {
        weekends_are: string;
      };
      assert.equal(lifestyle.weekends_are, spec.weekendsAre, spec.id);
      const vetoes = (payload.wardrobeInventory.style_vetoes ?? []) as Array<{
        value: string;
        note?: string;
      }>;
      const comfort = (payload.wardrobeInventory.comfort ?? []) as Array<{
        value: string;
        note?: string;
      }>;
      const annotated = [...vetoes, ...comfort];
      for (const v of spec.vetoes) {
        assert.ok(
          annotated.some((row) => row.value === v.value && row.note === v.note),
          `${spec.id} ${v.value}`,
        );
      }
      const brands = (payload.wardrobeInventory.brands ?? []) as Array<{
        brand: string;
        reasons: string[];
      }>;
      assert.deepEqual(
        brands.map((b) => b.brand),
        spec.brands.map((b) => b.brand),
      );
    }
  });
});
