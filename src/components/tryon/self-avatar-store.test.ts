import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSelfAvatarFromPeople,
  resolveTryonCta,
  selfAvatarWaiting,
} from "@/components/tryon/self-avatar-store";
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

  it("keeps create_avatar when avatar missing even if available is true", () => {
    assert.equal(
      resolveTryonCta({
        available: true,
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

  it("still dresses when the twin is ready and try-on is available", () => {
    assert.equal(
      resolveTryonCta({
        available: true,
        avatarStatus: "ready",
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

describe("selfAvatarWaiting", () => {
  it("is loading only when there is no twin on screen yet", () => {
    assert.equal(selfAvatarWaiting("loading", null), true);
    assert.equal(selfAvatarWaiting("unknown", null), true);
    assert.equal(selfAvatarWaiting("loading", "https://cdn.example/twin.jpg"), false);
    assert.equal(selfAvatarWaiting("ready", "https://cdn.example/twin.jpg"), false);
    assert.equal(selfAvatarWaiting("missing", null), false);
  });
});

describe("resolveSelfAvatarFromPeople", () => {
  const painted = {
    status: "ready" as const,
    personId: "guest-self",
    avatarUrl: "https://cdn.example/twin.jpg",
  };

  it("keeps the painted URL when a refetch returns a new signed URL", () => {
    const next = resolveSelfAvatarFromPeople(painted, [
      {
        id: "user-self",
        relation: "self",
        has_avatar: true,
        avatar_url: "https://cdn.example/twin.jpg?token=new",
      },
    ]);
    assert.equal(next.status, "ready");
    assert.equal(next.personId, "user-self");
    assert.equal(next.avatarUrl, painted.avatarUrl);
  });

  it("does not drop a minted twin when migrate has not landed yet", () => {
    const next = resolveSelfAvatarFromPeople(painted, [
      {
        id: "user-self",
        relation: "self",
        has_avatar: false,
        avatar_url: null,
      },
    ]);
    assert.equal(next.status, "ready");
    assert.equal(next.avatarUrl, painted.avatarUrl);
  });

  it("stays missing when there was never a twin", () => {
    const next = resolveSelfAvatarFromPeople(
      { status: "loading", personId: null, avatarUrl: null },
      [
        {
          id: "user-self",
          relation: "self",
          has_avatar: false,
          avatar_url: null,
        },
      ],
    );
    assert.equal(next.status, "missing");
    assert.equal(next.avatarUrl, null);
  });
});
