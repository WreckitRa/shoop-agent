import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET as adminRunsGET } from "@/app/api/admin/fashion/runs/route";
import { GET as cartGET } from "@/app/api/cart/route";
import { POST as chatPOST } from "@/app/api/chat/route";
import { POST as onboardingJobsPOST } from "@/app/api/cron/onboarding-jobs/route";
import { POST as privacyJobsPOST } from "@/app/api/cron/privacy-jobs/route";
import { POST as qaResetPOST } from "@/app/api/dev/qa-reset/route";
import { GET as healthGET } from "@/app/api/health/route";
import { isAllowedImageHost } from "@/app/api/media/image-proxy/route";
import { POST as tryonPOST } from "@/app/api/tryon/route";
import { POST as ordersWebhookPOST } from "@/app/api/webhooks/orders/route";
import { ADMIN_TOKEN_HEADER } from "@/lib/admin/auth";
import { onboardingPatchSchema } from "@/lib/onboarding/status";

function withoutSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return fn().finally(() => {
    if (prevUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (prevKey) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevKey;
    else delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });
}

function restore(name: string, value: string | undefined) {
  if (value) process.env[name] = value;
  else delete process.env[name];
}

describe("API edges", () => {
  it("GET /api/health returns ok payload", async () => {
    const res = await healthGET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(typeof body.ok, "boolean");
  });

  it("GET /api/admin/fashion/runs is 503 when unconfigured and 403 with a bad token", async () => {
    const prev = process.env.AI_CHAT_ADMIN_TOKEN;
    delete process.env.AI_CHAT_ADMIN_TOKEN;
    try {
      const unconfigured = await adminRunsGET(
        new Request("http://local/api/admin/fashion/runs"),
      );
      assert.equal(unconfigured.status, 503);

      process.env.AI_CHAT_ADMIN_TOKEN = "expected-token";
      const denied = await adminRunsGET(
        new Request("http://local/api/admin/fashion/runs", {
          headers: { [ADMIN_TOKEN_HEADER]: "wrong-token" },
        }),
      );
      assert.equal(denied.status, 403);
    } finally {
      restore("AI_CHAT_ADMIN_TOKEN", prev);
    }
  });

  it("POST /api/cron/privacy-jobs returns 401 without the cron secret", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron-test-secret";
    try {
      const res = await privacyJobsPOST(
        new Request("http://local/api/cron/privacy-jobs", { method: "POST" }),
      );
      assert.equal(res.status, 401);
      const onboarding = await onboardingJobsPOST(
        new Request("http://local/api/cron/onboarding-jobs", {
          method: "POST",
          headers: { authorization: "Bearer nope" },
        }),
      );
      assert.equal(onboarding.status, 401);
    } finally {
      restore("CRON_SECRET", prev);
    }
  });

  it("POST /api/dev/qa-reset rejects bad JSON, missing user_id, and unknown users", async () => {
    const invalid = await qaResetPOST(
      new Request("http://local/api/dev/qa-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    assert.equal(invalid.status, 400);

    const missing = await qaResetPOST(
      new Request("http://local/api/dev/qa-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(missing.status, 400);

    const prev = process.env.QA_USER_IDS;
    process.env.QA_USER_IDS = "allowed-user";
    try {
      const forbidden = await qaResetPOST(
        new Request("http://local/api/dev/qa-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: "someone-else" }),
        }),
      );
      assert.equal(forbidden.status, 404);
    } finally {
      restore("QA_USER_IDS", prev);
    }
  });

  it("POST /api/webhooks/orders is 503 when unconfigured and 401 with a bad HMAC", async () => {
    const prevCatalog = process.env.SHOPIFY_CATALOG_CLIENT_SECRET;
    const prevClient = process.env.CLIENT_SECRET;
    delete process.env.SHOPIFY_CATALOG_CLIENT_SECRET;
    delete process.env.CLIENT_SECRET;
    try {
      const unconfigured = await ordersWebhookPOST(
        new Request("http://local/api/webhooks/orders", {
          method: "POST",
          body: "{}",
        }),
      );
      assert.equal(unconfigured.status, 503);

      process.env.SHOPIFY_CATALOG_CLIENT_SECRET = "webhook-test-secret";
      const bad = await ordersWebhookPOST(
        new Request("http://local/api/webhooks/orders", {
          method: "POST",
          headers: { "x-shopify-hmac-sha256": "nope" },
          body: "{}",
        }),
      );
      assert.equal(bad.status, 401);
    } finally {
      restore("SHOPIFY_CATALOG_CLIENT_SECRET", prevCatalog);
      restore("CLIENT_SECRET", prevClient);
    }
  });

  it("authenticated JSON APIs return 401 without a session", async () => {
    await withoutSupabaseEnv(async () => {
      const cart = await cartGET();
      assert.equal(cart.status, 401);

      const chat = await chatPOST(
        new Request("http://local/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hello" }),
        }),
      );
      assert.equal(chat.status, 401);

      const tryon = await tryonPOST(
        new Request("http://local/api/tryon", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      assert.equal(tryon.status, 401);
    });
  });

  it("image proxy allowlist accepts storage hosts and rejects others", () => {
    assert.equal(isAllowedImageHost("xyz.supabase.co"), true);
    assert.equal(isAllowedImageHost("cdn.fashn.ai"), true);
    assert.equal(isAllowedImageHost("evil.example"), false);
    assert.equal(isAllowedImageHost("not-fashn.ai.evil"), false);
  });

  it("onboarding patch schema rejects unknown keys", () => {
    assert.equal(onboardingPatchSchema.safeParse({}).success, true);
    assert.equal(onboardingPatchSchema.safeParse({ nope: true }).success, false);
  });
});
