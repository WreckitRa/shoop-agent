import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { fetchAndResizeCurationImage, seedCurationImageCache, clearCurationImageCache } from "./curation-images";
import { CURATION_IMAGE_MAX_PX } from "./config";

test("fetchAndResizeCurationImage resizes oversized originals under the Anthropic cap", async () => {
  const oversized = await sharp({
    create: {
      width: 2400,
      height: 1800,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(oversized, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })) as typeof fetch;

  try {
    const block = await fetchAndResizeCurationImage(
      "https://images.example.com/merchant/huge-original.jpg",
    );
    assert.ok(block);
    assert.equal(block!.source.type, "base64");
    assert.equal(block!.source.media_type, "image/jpeg");

    const meta = await sharp(Buffer.from(block!.source.data, "base64")).metadata();
    assert.ok((meta.width ?? 0) <= CURATION_IMAGE_MAX_PX);
    assert.ok((meta.height ?? 0) <= CURATION_IMAGE_MAX_PX);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAndResizeCurationImage returns null on fetch failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as typeof fetch;
  try {
    const block = await fetchAndResizeCurationImage(
      "https://images.example.com/missing.jpg",
    );
    assert.equal(block, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("seeded 512px cache is reused without a network fetch", async () => {
  clearCurationImageCache();
  const url = "https://images.example.com/prepared.jpg";
  seedCurationImageCache({
    [url]: {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "aaa" },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network should not run");
  }) as typeof fetch;
  try {
    const block = await fetchAndResizeCurationImage(url);
    assert.equal(block?.source.data, "aaa");
  } finally {
    globalThis.fetch = originalFetch;
    clearCurationImageCache();
  }
});
