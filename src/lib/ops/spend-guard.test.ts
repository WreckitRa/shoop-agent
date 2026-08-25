import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  PHOTO_MODEL_COST_ESTIMATES,
  PhotoSpendCapError,
  assertPhotoModelSpend,
} from "./spend-guard";

describe("assertPhotoModelSpend", () => {
  beforeEach(() => {
    process.env.PHOTO_MODEL_DAILY_SPEND_CAP = "1";
    process.env.PHOTO_MODEL_SPEND_NS = `t-${Date.now()}-${Math.random()}`;
  });

  it("blocks once estimated spend crosses the daily cap", async () => {
    const chunk = PHOTO_MODEL_COST_ESTIMATES.analysis;
    await assertPhotoModelSpend(chunk);
    await assertPhotoModelSpend(chunk);
    await assert.rejects(() => assertPhotoModelSpend(chunk), PhotoSpendCapError);
  });
});
