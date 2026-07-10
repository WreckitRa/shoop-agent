import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLabelsResultSchema,
  coerceClassifyLabelsInput,
} from "./llm-classify";

test("coerceClassifyLabelsInput moves numeric alpha into numeric field", () => {
  const coerced = coerceClassifyLabelsInput({
    colors: [{ raw: "navy", buckets: ["navy"] }],
    sizes: [
      { raw: "32", category: "bottoms", size: { alpha: "32" } },
      { raw: "M", category: "tops", size: { alpha: "m" } },
      { raw: "10", category: "shoes", size: { alpha: "10", numeric_system: "us" } },
    ],
  });
  const parsed = classifyLabelsResultSchema.safeParse(coerced);
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  assert.equal(parsed.data.sizes[0]!.size?.alpha, undefined);
  assert.equal(parsed.data.sizes[0]!.size?.numeric, 32);
  assert.equal(parsed.data.sizes[1]!.size?.alpha, "M");
  assert.equal(parsed.data.sizes[2]!.size?.numeric, 10);
  assert.equal(parsed.data.sizes[2]!.size?.numeric_system, "us");
});
