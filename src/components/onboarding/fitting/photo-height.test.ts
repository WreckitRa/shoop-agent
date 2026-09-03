import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  heightCmForTwinMint,
  heightCmFromPhotoValues,
  type FittingPhotoValues,
} from "./FittingPhotoStep";
import { DEFAULT_SILHOUETTE_HEIGHT_CM } from "./bodySilhouetteGeometry";

function photo(
  over: Partial<FittingPhotoValues> = {},
): FittingPhotoValues {
  return {
    photoPreview: null,
    photoCoverage: "face",
    heightUnit: "ft",
    heightFt: null,
    heightIn: null,
    heightCm: null,
    weightValue: null,
    weightUnit: "lb",
    weightSkipped: false,
    build: null,
    muscularity: null,
    bodyShape: null,
    bustFullness: null,
    legLine: null,
    ...over,
  };
}

describe("heightCmFromPhotoValues", () => {
  it("stays blank until they type a height", () => {
    assert.equal(heightCmFromPhotoValues(photo()), null);
    assert.equal(
      heightCmFromPhotoValues(photo({ heightUnit: "cm", heightCm: null })),
      null,
    );
  });

  it("converts imperial and keeps centimetres as typed", () => {
    assert.equal(
      heightCmFromPhotoValues(
        photo({ heightUnit: "ft", heightFt: 5, heightIn: 9 }),
      ),
      Math.round((5 * 12 + 9) * 2.54),
    );
    assert.equal(
      heightCmFromPhotoValues(
        photo({ heightUnit: "cm", heightCm: 168 }),
      ),
      168,
    );
  });
});

describe("heightCmForTwinMint", () => {
  it("uses the silhouette default when fit height is skipped", () => {
    assert.equal(heightCmForTwinMint(photo()), DEFAULT_SILHOUETTE_HEIGHT_CM);
    assert.equal(
      heightCmForTwinMint(photo({ heightUnit: "cm", heightCm: 168 })),
      168,
    );
  });
});
