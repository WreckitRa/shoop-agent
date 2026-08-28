import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearPendingFittingPhoto,
  getPendingFittingPhoto,
  loadPersistedFittingPhoto,
  setPendingFittingPhoto,
} from "./pending-photo";

describe("pending fitting photo", () => {
  it("holds a file until cleared", () => {
    const file = new File(["x"], "face.jpg", { type: "image/jpeg" });
    setPendingFittingPhoto(file);
    assert.equal(getPendingFittingPhoto(), file);
    clearPendingFittingPhoto();
    assert.equal(getPendingFittingPhoto(), null);
  });

  it("load prefers the in-memory file", async () => {
    const file = new File(["x"], "face.jpg", { type: "image/jpeg" });
    setPendingFittingPhoto(file);
    assert.equal(await loadPersistedFittingPhoto(), file);
    clearPendingFittingPhoto();
  });
});
