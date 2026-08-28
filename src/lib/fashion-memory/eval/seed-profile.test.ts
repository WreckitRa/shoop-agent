import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withPersonaId } from "./persona";
import { seedPersonaSnapshot } from "./seed-profile";

describe("seedPersonaSnapshot signal types", () => {
  it("classifies navy/tailored/linen from the token, not as color-only", () => {
    const persona = withPersonaId({
      name: "Maya",
      language: "en",
      patience: "quick",
      volunteers: "some",
      profile: {
        state: "known_relevant",
        department: "womens",
        signals: [
          "+navy [work, stated]",
          "+tailored [work, stated]",
          "+linen [summer, stated]",
        ],
      },
      truth: {
        request_type: "outfit",
        garments: ["blazer"],
        occasion: "work",
        depth: { looks: 1 },
        anchor: "keep",
      },
      opening_message: "need a blazer",
    });
    const { snapshot } = seedPersonaSnapshot(persona, "guest-eval-maya");
    const byValue = new Map(
      snapshot.style_signals.map((s) => [s.value, s.signal_type]),
    );
    assert.equal(byValue.get("navy"), "color");
    assert.equal(byValue.get("tailored"), "silhouette");
    assert.equal(byValue.get("linen"), "material");
  });

  it("honors an explicit type token in the meta list", () => {
    const persona = withPersonaId({
      name: "Theo",
      language: "en",
      patience: "normal",
      volunteers: "some",
      profile: {
        state: "known_relevant",
        department: "mens",
        signals: ["+quiet-luxury [work, stated, aesthetic]"],
      },
      truth: {
        request_type: "single_item",
        garments: ["coat"],
        occasion: "work",
        depth: { options: 3 },
        anchor: "explore",
      },
      opening_message: "need a coat",
    });
    const { snapshot } = seedPersonaSnapshot(persona, "guest-eval-theo");
    assert.equal(snapshot.style_signals[0]?.signal_type, "aesthetic");
  });
});
