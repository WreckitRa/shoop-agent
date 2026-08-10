import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tryonPathFromStoredUrl } from "./storage";

describe("tryonPathFromStoredUrl", () => {
  it("strips sign host + bucket from an expired signed url", () => {
    const url =
      "https://etdanguqkhiiyqeibmvm.supabase.co/storage/v1/object/sign/tryon-private/69e114ef-f3aa-45af-bdac-bc73889cbc14/6ceb40fe-6257-4cea-af96-03dd8221b858/tryon/outfit-fashn-dress_1_6-1786096329521.jpg?token=expired";
    assert.equal(
      tryonPathFromStoredUrl(url),
      "69e114ef-f3aa-45af-bdac-bc73889cbc14/6ceb40fe-6257-4cea-af96-03dd8221b858/tryon/outfit-fashn-dress_1_6-1786096329521.jpg",
    );
  });

  it("returns null for unrelated urls", () => {
    assert.equal(tryonPathFromStoredUrl("https://cdn.example.com/x.jpg"), null);
  });
});
