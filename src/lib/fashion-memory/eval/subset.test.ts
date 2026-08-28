import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stratifiedSubset } from "./subset";
import type { Persona } from "./persona";

function mkPersona(
  id: string,
  state: Persona["profile"]["state"],
  request_type: Persona["truth"]["request_type"],
): Persona {
  return {
    id,
    name: id,
    language: "en",
    patience: "normal",
    volunteers: "some",
    profile: { state },
    truth: {
      request_type,
      garments: ["shirt"],
      owns: [],
      occasion: "work",
      depth: { looks: 2 },
      anchor: "n/a",
    },
    opening_message: "shirt for work",
  };
}

describe("stratifiedSubset", () => {
  it("covers profile × request_type cells when N allows", () => {
    const personas: Persona[] = [];
    let i = 0;
    for (const state of [
      "new",
      "known_relevant",
      "quick_shopper",
    ] as const) {
      for (const rt of ["outfit", "single_item", "capsule"] as const) {
        personas.push(mkPersona(`p${i++}`, state, rt));
        personas.push(mkPersona(`p${i++}`, state, rt));
      }
    }
    const sub = stratifiedSubset(personas, 12, 1);
    assert.equal(sub.length, 12);
    const cells = new Set(
      sub.map((p) => `${p.profile.state}×${p.truth.request_type}`),
    );
    assert.ok(cells.size >= 6);
  });

  it("is deterministic for the same seed", () => {
    const personas = Array.from({ length: 40 }, (_, i) =>
      mkPersona(
        `x${i}`,
        i % 2 === 0 ? "new" : "known_relevant",
        i % 3 === 0 ? "outfit" : "single_item",
      ),
    );
    const a = stratifiedSubset(personas, 8, 42).map((p) => p.id);
    const b = stratifiedSubset(personas, 8, 42).map((p) => p.id);
    assert.deepEqual(a, b);
  });
});
