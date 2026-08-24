import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import { isResendConfigured } from "@/lib/auth/resend";
import {
  VERIFY_EMAIL_COOKIE,
  issueExistingVerification,
  readVerifyEmailCookie,
} from "@/lib/auth/email-verification";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isSupabaseAuthConfigured() || !isResendConfigured()) {
    return NextResponse.json(
      { error: "Email verification is not configured on this server." },
      { status: 503 },
    );
  }

  const jar = await cookies();
  const email = readVerifyEmailCookie(jar.get(VERIFY_EMAIL_COOKIE)?.value)?.email;
  if (!email) {
    return NextResponse.json(
      { error: "Start signup again to send a new code." },
      { status: 401 },
    );
  }

  try {
    const issued = await issueExistingVerification(email);
    if (!issued.ok) {
      return NextResponse.json({ error: issued.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, email });
  } catch {
    return NextResponse.json(
      { error: "Could not send a new code." },
      { status: 500 },
    );
  }
}
