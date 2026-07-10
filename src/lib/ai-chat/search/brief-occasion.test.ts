import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOccasionAmbiguity } from "./brief-occasion";
import { blazerTraceBrief } from "./fixtures/blazer-trace-fixture";

describe("occasion disambiguation", () => {
  it("resolves work/office to nightlife when profile says nightlife", () => {
    const resolved = resolveOccasionAmbiguity(blazerTraceBrief, {
      workEnvironment: "nightlife / events / DJ",
      lifestyleTags: ["nightlife", "events"],
      occupation: "DJ",
    });
    assert.match(resolved.useCase ?? "", /nightlife/i);
    assert.equal(
      resolved.mustHaves.some((m) => /work|office/i.test(m)),
      false,
    );
    assert.ok(resolved.provenance?.occasionResolution);
  });

  it("keeps office reading when profile confirms office", () => {
    const resolved = resolveOccasionAmbiguity(blazerTraceBrief, {
      workEnvironment: "corporate office",
      lifestyleTags: [],
    });
    assert.ok(
      resolved.mustHaves.some((m) => /work|office/i.test(m)) ||
        /office|work/i.test(resolved.useCase ?? ""),
    );
  });
});
