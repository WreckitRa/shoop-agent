import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avatarImageSrc, resolveDisplayedAvatarUrl } from "./image-src";

describe("avatarImageSrc", () => {
  it("is a same-origin path keyed by person id", () => {
    assert.equal(avatarImageSrc("abc-123"), "/api/avatar/abc-123/image");
  });
});

describe("resolveDisplayedAvatarUrl", () => {
  it("prefers a live signed URL so guest <img> tags do not need the session header", () => {
    assert.equal(
      resolveDisplayedAvatarUrl({
        personId: "p1",
        hasAvatar: true,
        signedUrl: "https://cdn.example/twin.jpg",
      }),
      "https://cdn.example/twin.jpg",
    );
  });

  it("falls back to the re-sign route when bytes exist but signing failed", () => {
    assert.equal(
      resolveDisplayedAvatarUrl({
        personId: "p1",
        hasAvatar: true,
        signedUrl: null,
      }),
      "/api/avatar/p1/image",
    );
  });

  it("is empty when there is no twin", () => {
    assert.equal(
      resolveDisplayedAvatarUrl({
        personId: "p1",
        hasAvatar: false,
        signedUrl: null,
      }),
      null,
    );
  });
});
