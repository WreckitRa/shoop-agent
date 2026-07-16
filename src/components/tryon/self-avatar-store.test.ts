import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTryonCta } from "@/components/tryon/self-avatar-store";

describe("resolveTryonCta", () => {
  it("keeps create_avatar when avatar missing", () => {
    assert.equal(
      resolveTryonCta({
        available: false,
        cta: "create_avatar",
        avatarStatus: "missing",
      }),
      "create_avatar",
    );
  });

  it("flips create_avatar to tryon once avatar is ready", () => {
    assert.equal(
      resolveTryonCta({
        available: false,
        cta: "create_avatar",
        avatarStatus: "ready",
      }),
      "tryon",
    );
  });

  it("respects available tryon", () => {
    assert.equal(
      resolveTryonCta({
        available: true,
        avatarStatus: "missing",
      }),
      "tryon",
    );
  });

  it("hides when neither available nor create cta", () => {
    assert.equal(
      resolveTryonCta({
        available: false,
        avatarStatus: "ready",
      }),
      "hidden",
    );
  });
});
