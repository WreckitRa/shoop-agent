import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passesShippingTextGuard } from "./shipping-text-guard";

describe("shipping text guard", () => {
  it("drops listings that exclude US buyers in the title", () => {
    assert.equal(
      passesShippingTextGuard(
        "Gadget Club Tech Gadget Box — No US Customers please",
        "US",
      ),
      false,
    );
  });

  it("allows normal US-shippable listings", () => {
    assert.equal(
      passesShippingTextGuard("Wireless Bluetooth Speaker — Ships to USA", "US"),
      true,
    );
  });
});
