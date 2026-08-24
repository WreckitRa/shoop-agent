import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTryonCta } from "@/components/tryon/self-avatar-store";
import {
  guestFittingCtaLabel,
  resolveMirrorEntry,
} from "@/components/tryon/mirror-entry";

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

describe("resolveMirrorEntry", () => {
  it("sends guests without a twin into onboarding", () => {
    assert.equal(
      resolveMirrorEntry({
        accessMode: "guest",
        avatarReady: false,
        hasRackOrActive: true,
      }),
      "onboarding",
    );
  });

  it("sends anonymous visitors to signup", () => {
    assert.equal(
      resolveMirrorEntry({
        accessMode: "anonymous",
        avatarReady: false,
        hasRackOrActive: false,
      }),
      "signup",
    );
  });

  it("sends signed-in users without a twin into onboarding", () => {
    assert.equal(
      resolveMirrorEntry({
        accessMode: "authenticated",
        avatarReady: false,
        hasRackOrActive: false,
      }),
      "onboarding",
    );
  });

  it("opens the fitting room when the twin is ready and the rack has pieces", () => {
    assert.equal(
      resolveMirrorEntry({
        accessMode: "authenticated",
        avatarReady: true,
        hasRackOrActive: true,
      }),
      "fitting_room",
    );
  });

  it("opens the avatar viewer when the twin is ready and the rack is empty", () => {
    assert.equal(
      resolveMirrorEntry({
        accessMode: "authenticated",
        avatarReady: true,
        hasRackOrActive: false,
      }),
      "avatar_viewer",
    );
  });
});

describe("guestFittingCtaLabel", () => {
  it("does not promise an on-you preview for guests", () => {
    assert.equal(guestFittingCtaLabel("overlay"), "CLAIM PRINT →");
    assert.equal(guestFittingCtaLabel("button"), "Sign up to see it on you");
    assert.equal(
      guestFittingCtaLabel("look"),
      "Sign up to see the full look",
    );
  });
});
