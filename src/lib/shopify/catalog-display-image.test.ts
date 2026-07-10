import assert from "node:assert/strict";
import test from "node:test";
import { catalogDisplayImageUrl } from "./catalog-display-image";

test("catalogDisplayImageUrl adds width for Shopify CDN URLs", () => {
  const url =
    "https://cdn.shopify.com/s/files/1/0000/0001/products/jacket.jpg?v=123";
  const out = catalogDisplayImageUrl(url, 280);
  assert.match(out, /width=280/);
  assert.doesNotMatch(out, /height=/);
  assert.match(out, /v=123/);
});

test("catalogDisplayImageUrl can square-crop for judge thumbs", () => {
  const url = "https://cdn.shopify.com/s/files/1/0000/0001/products/jacket.jpg";
  const out = catalogDisplayImageUrl(url, 768, { crop: "center" });
  assert.match(out, /width=768/);
  assert.match(out, /height=768/);
  assert.match(out, /crop=center/);
});

test("catalogDisplayImageUrl leaves non-Shopify hosts unchanged", () => {
  const url = "https://images.unsplash.com/photo-123?w=800";
  assert.equal(catalogDisplayImageUrl(url, 280), url);
});

test("catalogDisplayImageUrl passes through invalid URLs", () => {
  assert.equal(catalogDisplayImageUrl("not-a-url", 280), "not-a-url");
  assert.equal(catalogDisplayImageUrl("", 280), "");
});
