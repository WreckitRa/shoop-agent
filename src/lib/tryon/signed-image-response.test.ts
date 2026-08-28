import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAbsoluteHttpUrl,
  respondWithSignedImageSrc,
} from "./signed-image-response";

describe("isAbsoluteHttpUrl", () => {
  it("accepts https", () => {
    assert.equal(isAbsoluteHttpUrl("https://cdn.example/a.jpg"), true);
  });

  it("rejects relative paths that would 404 the app", () => {
    assert.equal(isAbsoluteHttpUrl("user/person/avatar.jpg"), false);
    assert.equal(isAbsoluteHttpUrl("/api/tryon/image/x"), false);
  });
});

describe("respondWithSignedImageSrc", () => {
  it("404s relative URLs instead of redirecting the document", () => {
    const res = respondWithSignedImageSrc("user/person/tryon/file.jpg");
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("Location"), null);
  });

  it("redirects absolute https", () => {
    const res = respondWithSignedImageSrc("https://cdn.example/look.jpg");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "https://cdn.example/look.jpg");
  });
});
