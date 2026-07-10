import assert from "node:assert/strict";
import test from "node:test";
import { formatFinalistsForCompare } from "./attributes-prompt";
import { judgeThumbnailUrl } from "./finalist-images";
import type { VerifiedCandidate } from "../search/verify";

test("judgeThumbnailUrl adds width for Shopify CDN URLs", () => {
  const url =
    "https://cdn.shopify.com/s/files/1/0000/0001/products/jacket.jpg?v=123";
  const out = judgeThumbnailUrl(url);
  assert.match(out, /width=768/);
  assert.match(out, /height=768/);
});

test("formatFinalistsForCompare keeps image_ref aligned with product ids", () => {
  const verified = [
    {
      detail: { id: "gid://shopify/Product/1", title: "Blazer A" },
      upid: "u1",
    },
    {
      detail: { id: "gid://shopify/Product/2", title: "Blazer B" },
      upid: "u2",
    },
  ] as VerifiedCandidate[];

  const { candidatesBlock, entries } = formatFinalistsForCompare(verified);
  assert.equal(entries.length, 2);
  assert.match(candidatesBlock, /image_ref: candidate-0|image_ref: candidate-1/);
  for (const entry of entries) {
    assert.match(candidatesBlock, new RegExp(`id=${entry.productId.replace(/[/]/g, "\\/")}`));
    assert.match(candidatesBlock, new RegExp(`image_ref: ${entry.imageRef}`));
  }
});
