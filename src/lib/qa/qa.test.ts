import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { harvestVetoesFromToolContent } from "@/lib/fashion-memory/curation/tool-schema";
import { buildForceInvalidCurationMessage } from "@/lib/qa/curation-fault";
import {
  clearQaFaultsForConversation,
  consumeQaFault,
  enterQaConversation,
  listQaFaultsForConversation,
  setQaFaultsForConversation,
} from "@/lib/qa/faults";
import { resolveProductRef } from "@/lib/qa/resolve-product-ref";

describe("qa_faults", () => {
  it("fires once and logs via consume", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    setQaFaultsForConversation("conv-1", [{ name: "fail_one_lane" }]);
    enterQaConversation("conv-1");
    assert.equal(consumeQaFault(null, "fail_one_lane", "trace-1"), true);
    assert.equal(consumeQaFault(null, "fail_one_lane", "trace-1"), false);
    clearQaFaultsForConversation("conv-1");
    process.env.NODE_ENV = prev;
  });

  it("kill_next_hydration decrements n", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    setQaFaultsForConversation("conv-2", [{ name: "kill_next_hydration", n: 2 }]);
    enterQaConversation("conv-2");
    assert.equal(consumeQaFault(null, "kill_next_hydration"), true);
    assert.equal(consumeQaFault(null, "kill_next_hydration"), true);
    assert.equal(consumeQaFault(null, "kill_next_hydration"), false);
    clearQaFaultsForConversation("conv-2");
    process.env.NODE_ENV = prev;
  });
});

describe("force_invalid_curation_harvest", () => {
  it("harvests veto from canned invalid output", () => {
    const msg = buildForceInvalidCurationMessage("B2");
    const vetoes = harvestVetoesFromToolContent(msg.content);
    assert.equal(vetoes.length, 1);
    assert.equal(vetoes[0]?.ref, "B2");
    assert.equal(vetoes[0]?.reason, "wrong_item_type");
  });
});

describe("resolveProductRef", () => {
  it("accepts gid, numeric id, and urls", () => {
    assert.equal(
      resolveProductRef("gid://shopify/Product/123"),
      "gid://shopify/Product/123",
    );
    assert.equal(resolveProductRef("456"), "gid://shopify/Product/456");
    assert.equal(
      resolveProductRef("https://catalog.shopify.com/products/789"),
      "gid://shopify/Product/789",
    );
  });
});
