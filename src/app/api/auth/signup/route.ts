import { NextResponse } from "next/server";
import { signUpBodySchema } from "@/lib/auth/validators";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import { isResendConfigured } from "@/lib/auth/resend";
import {
  VERIFY_EMAIL_COOKIE,
  issueSignupVerification,
  signVerifyEmailCookie,
  verifyEmailCookieOptions,
} from "@/lib/auth/email-verification";
import { LEGAL_DOC_VERSION } from "@/lib/legal/constants";
import { decideSignupRegion } from "@/lib/legal/geo-gate";
import { detectRequestArea } from "@/lib/server/request-area";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }
  if (!isResendConfigured()) {
    return NextResponse.json(
      { error: "Email verification is not configured on this server." },
      { status: 503 },
    );
  }

  const region = decideSignupRegion(detectRequestArea(req.headers)?.countryCode);
  if (!region.ok) {
    return NextResponse.json({ error: region.reason }, { status: 403 });
  }

  try {
    const raw = await req.json();
    const parsed = signUpBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: issue?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const issued = await issueSignupVerification({ email, password });
    if (!issued.ok) {
      return NextResponse.json({ error: issued.error }, { status: issued.status });
    }

    const res = NextResponse.json({
      pendingVerification: true,
      email,
    });
    res.cookies.set(
      VERIFY_EMAIL_COOKIE,
      signVerifyEmailCookie({
        email,
        ageAttested: true,
        termsVersion: LEGAL_DOC_VERSION,
      }),
      verifyEmailCookieOptions(),
    );
    return res;
  } catch {
    return NextResponse.json({ error: "Sign up failed." }, { status: 500 });
  }
}
