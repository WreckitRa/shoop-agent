import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHOTO_MAX_BYTES } from "./decode";
import { inspectPhotoBytes } from "./inspect-photo";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0x00]),
]);

describe("inspectPhotoBytes", () => {
  it("accepts jpeg, png, and webp by magic bytes", () => {
    assert.equal(inspectPhotoBytes(jpeg).ok, true);
    assert.equal(inspectPhotoBytes(png).ok, true);
    assert.equal(inspectPhotoBytes(webp).ok, true);
  });

  it("rejects empty, oversized, and non-image payloads", () => {
    const empty = inspectPhotoBytes(Buffer.alloc(0));
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.status, 400);

    const huge = inspectPhotoBytes(Buffer.alloc(PHOTO_MAX_BYTES + 1, 0xff));
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.equal(huge.status, 413);

    const svg = inspectPhotoBytes(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
    assert.equal(svg.ok, false);
    if (!svg.ok) assert.equal(svg.status, 415);
  });
});
