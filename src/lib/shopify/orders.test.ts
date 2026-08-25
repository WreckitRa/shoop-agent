import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyOrderWebhook } from "./orders";

describe("verifyOrderWebhook", () => {
  it("accepts a matching Shopify HMAC and rejects missing or wrong signatures", () => {
    const body = Buffer.from('{"id":1}', "utf8");
    const secret = "shop-secret";
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    assert.equal(
      verifyOrderWebhook(body, new Headers({ "x-shopify-hmac-sha256": hmac }), secret),
      true,
    );
    assert.equal(verifyOrderWebhook(body, new Headers(), secret), false);
    assert.equal(
      verifyOrderWebhook(
        body,
        new Headers({ "x-shopify-hmac-sha256": "aaaa" }),
        secret,
      ),
      false,
    );
  });
});
