import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { getResendClient, getResendFrom } from "@/lib/auth/resend";
import { getSiteUrl } from "@/lib/seo/site";

export const VERIFY_EMAIL_COOKIE = "shoop_verify_email";
const VERIFY_COOKIE_MAX_AGE_SEC = 60 * 60;

function verifyCookieSecret(): string {
  return (
    process.env.GUEST_SESSION_HMAC_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    ""
  );
}

export type SignupVerifyCookie = {
  email: string;
  birthDate?: string | null;
  termsVersion?: string | null;
};

export function signVerifyEmailCookie(
  payload: string | SignupVerifyCookie,
): string {
  const data: SignupVerifyCookie =
    typeof payload === "string"
      ? { email: payload.trim().toLowerCase() }
      : {
          email: payload.email.trim().toLowerCase(),
          birthDate: payload.birthDate ?? null,
          termsVersion: payload.termsVersion ?? null,
        };
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", verifyCookieSecret())
    .update(encoded)
    .digest("hex");
  return `${encoded}.${sig}`;
}

export function readVerifyEmailCookie(
  raw: string | undefined,
): SignupVerifyCookie | null {
  if (!raw) return null;
  const secret = verifyCookieSecret();
  if (!secret) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (
      !timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    if (decoded.startsWith("{")) {
      const parsed = JSON.parse(decoded) as SignupVerifyCookie;
      const email = parsed.email?.trim().toLowerCase();
      if (!email) return null;
      return {
        email,
        birthDate: parsed.birthDate ?? null,
        termsVersion: parsed.termsVersion ?? null,
      };
    }
    return { email: decoded.trim().toLowerCase() };
  } catch {
    return null;
  }
}


export function verifyEmailCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VERIFY_COOKIE_MAX_AGE_SEC,
  };
}

function confirmUrl(tokenHash: string, type: string): string {
  const origin = getSiteUrl().origin;
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}

export async function issueSignupVerification(args: {
  email: string;
  password: string;
}): Promise<
  | { ok: true }
  | { ok: false; status: 409 | 400 | 503; error: string }
> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: args.email,
    password: args.password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return {
        ok: false,
        status: 409,
        error: "An account with this email already exists. Try signing in.",
      };
    }
    return { ok: false, status: 400, error: error.message };
  }

  if (data.user?.id && data.user.email_confirmed_at) {
    await admin.auth.admin.updateUserById(data.user.id, {
      email_confirm: false,
    });
  }

  const properties = data.properties;
  if (!properties?.hashed_token || !properties.email_otp) {
    return { ok: false, status: 400, error: "Could not start verification." };
  }

  await sendVerificationEmail({
    email: args.email,
    code: properties.email_otp,
    confirmHref: confirmUrl(
      properties.hashed_token,
      properties.verification_type || "signup",
    ),
  });
  return { ok: true };
}

export async function issueExistingVerification(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) return { ok: false, error: error.message };
  const properties = data.properties;
  if (!properties?.hashed_token || !properties.email_otp) {
    return { ok: false, error: "Could not send verification." };
  }
  await sendVerificationEmail({
    email,
    code: properties.email_otp,
    confirmHref: confirmUrl(
      properties.hashed_token,
      properties.verification_type || "magiclink",
    ),
  });
  return { ok: true };
}

async function sendVerificationEmail(args: {
  email: string;
  code: string;
  confirmHref: string;
}): Promise<void> {
  const { error } = await getResendClient().emails.send({
    from: getResendFrom(),
    to: args.email,
    subject: "Your Shoop confirmation code",
    html: verificationHtml(args),
    text: [
      `Your Shoop code is ${args.code}.`,
      `Or confirm here: ${args.confirmHref}`,
      "",
      "If you didn't ask for a Shoop account, ignore this email.",
    ].join("\n"),
  });
  if (error) {
    throw new Error(error.message);
  }
}

function verificationHtml(args: { code: string; confirmHref: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f7;font-family:ui-sans-serif,system-ui,sans-serif;color:#0e0e11;">
    <div style="max-width:480px;margin:32px auto;padding:32px 28px;background:#fff;border:1px solid #e8e8ec;border-radius:18px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.14em;color:#e42831;">SHOOP</p>
      <h1 style="margin:0 0 12px;font-size:26px;letter-spacing:-.03em;">Confirm it's you.</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#8a8a93;">
        Enter this code in the app, or tap the button. Nobody else can finish signup without it.
      </p>
      <p style="margin:0 0 22px;font-size:32px;font-weight:800;letter-spacing:.28em;text-align:center;">${args.code}</p>
      <p style="text-align:center;margin:0 0 22px;">
        <a href="${args.confirmHref}" style="display:inline-block;background:#0e0e11;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:14px 22px;border-radius:12px;">Confirm email</a>
      </p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#8a8a93;">
        If you didn't ask for a Shoop account, ignore this. The code expires in about an hour.
      </p>
    </div>
  </body>
</html>`;
}

export function isEmailOtpType(value: string | null): value is EmailOtpType {
  return (
    value === "signup" ||
    value === "invite" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "email_change" ||
    value === "email"
  );
}
