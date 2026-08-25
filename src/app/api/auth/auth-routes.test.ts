import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELETE as accountDELETE } from "@/app/api/auth/account/route";
import { POST as guestPOST } from "@/app/api/auth/guest/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as resendPOST } from "@/app/api/auth/resend-verification/route";
import { GET as sessionGET } from "@/app/api/auth/session/route";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as verifyPOST } from "@/app/api/auth/verify-email/route";
import {
  deleteAccountBodySchema,
  signInBodySchema,
  signUpBodySchema,
} from "@/lib/auth/validators";

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



function withDummyAuthEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY,
    resendKey: process.env.RESEND_API_KEY,
    resendFrom: process.env.RESEND_FROM,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM = "Shoop <noreply@example.com>";
  return fn().finally(() => {
    restore("NEXT_PUBLIC_SUPABASE_URL", prev.url);
    restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", prev.key);
    restore("SUPABASE_SECRET_KEY", prev.secret);
    restore("RESEND_API_KEY", prev.resendKey);
    restore("RESEND_FROM", prev.resendFrom);
  });
}

function restore(name: string, value: string | undefined) {
  if (value) process.env[name] = value;
  else delete process.env[name];
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("auth API edges", () => {
  it("GET /api/auth/session reports unconfigured when env is missing", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await sessionGET();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { configured: boolean; user: unknown };
      assert.equal(body.configured, false);
      assert.equal(body.user, null);
    });
  });

  it("POST /api/auth/login returns 503 when auth is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await loginPOST(
        new Request("http://local/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "a@b.com", password: "password1" }),
        }),
      );
      assert.equal(res.status, 503);
    });
  });

  it("sign-in body schema rejects invalid email and short passwords", () => {
    assert.equal(signInBodySchema.safeParse({ email: "not-an-email", password: "password1" }).success, false);
    assert.equal(signInBodySchema.safeParse({ email: "a@b.com", password: "short" }).success, false);
    assert.equal(signInBodySchema.safeParse({ email: "a@b.com", password: "password1" }).success, true);
  });

  it("POST /api/auth/logout succeeds when auth is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await logoutPOST();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    });
  });

  it("POST /api/auth/guest mints a session token", async () => {
    const res = await guestPOST();
    assert.equal(res.status, 201);
    const body = (await res.json()) as { token: string };
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.length > 8);
  });

  it("POST /api/auth/signup returns 503 when auth is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await signupPOST(
        jsonRequest("http://local/api/auth/signup", {
          email: "a@b.com",
          password: "password1",
          birthDate: "1990-01-15",
          acceptTerms: true,
        }),
      );
      assert.equal(res.status, 503);
    });
  });

  it("POST /api/auth/verify-email returns 503 when auth is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await verifyPOST(
        jsonRequest("http://local/api/auth/verify-email", {
          email: "a@b.com",
          token: "123456",
        }),
      );
      assert.equal(res.status, 503);
    });
  });

  it("POST /api/auth/resend-verification returns 503 when verification is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await resendPOST();
      assert.equal(res.status, 503);
    });
  });

  it("DELETE /api/auth/account returns 503 when auth is not configured", async () => {
    await withoutSupabaseEnv(async () => {
      const res = await accountDELETE(
        jsonRequest("http://local/api/auth/account", { password: "password1" }),
      );
      assert.equal(res.status, 503);
    });
  });

  it("POST /api/auth/login returns 400 for invalid body when auth is configured", async () => {
    await withDummyAuthEnv(async () => {
      const res = await loginPOST(
        jsonRequest("http://local/api/auth/login", {
          email: "not-an-email",
          password: "password1",
        }),
      );
      assert.equal(res.status, 400);
    });
  });

  it("POST /api/auth/signup returns 403 outside the US", async () => {
    await withDummyAuthEnv(async () => {
      const res = await signupPOST(
        jsonRequest(
          "http://local/api/auth/signup",
          {
            email: "a@b.com",
            password: "password1",
            birthDate: "1990-01-15",
            acceptTerms: true,
          },
          { "cf-ray": "test", "cf-ipcountry": "GB" },
        ),
      );
      assert.equal(res.status, 403);
    });
  });

  it("POST /api/auth/signup returns 400 when terms are not accepted", async () => {
    await withDummyAuthEnv(async () => {
      const res = await signupPOST(
        jsonRequest("http://local/api/auth/signup", {
          email: "a@b.com",
          password: "password1",
          birthDate: "1990-01-15",
          acceptTerms: false,
        }),
      );
      assert.equal(res.status, 400);
    });
  });

  it("POST /api/auth/signup returns 403 for underage birth dates", async () => {
    await withDummyAuthEnv(async () => {
      const recent = new Date();
      recent.setUTCFullYear(recent.getUTCFullYear() - 10);
      const res = await signupPOST(
        jsonRequest("http://local/api/auth/signup", {
          email: "a@b.com",
          password: "password1",
          birthDate: recent.toISOString().slice(0, 10),
          acceptTerms: true,
        }),
      );
      assert.equal(res.status, 403);
    });
  });

  it("sign-up and delete-account schemas reject incomplete payloads", () => {
    assert.equal(
      signUpBodySchema.safeParse({
        email: "a@b.com",
        password: "password1",
        birthDate: "1990-01-15",
        acceptTerms: false,
      }).success,
      false,
    );
    assert.equal(
      signUpBodySchema.safeParse({
        email: "a@b.com",
        password: "password1",
        birthDate: "1990-01-15",
        acceptTerms: true,
      }).success,
      true,
    );
    assert.equal(deleteAccountBodySchema.safeParse({ password: "" }).success, false);
    assert.equal(deleteAccountBodySchema.safeParse({ password: "x" }).success, true);
  });
});
