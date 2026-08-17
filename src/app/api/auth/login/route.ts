import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { signInBodySchema } from "@/lib/auth/validators";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import { isResendConfigured } from "@/lib/auth/resend";
import {
  VERIFY_EMAIL_COOKIE,
  issueExistingVerification,
  signVerifyEmailCookie,
  verifyEmailCookieOptions,
} from "@/lib/auth/email-verification";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }

  try {
    const raw = await req.json();
    const parsed = signInBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: issue?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      const msg = (error?.message ?? "").toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
        if (isResendConfigured()) {
          await issueExistingVerification(email);
        }
        const res = NextResponse.json(
          {
            error: "Confirm the code we sent to your email before signing in.",
            code: "email_not_confirmed",
            email,
            pendingVerification: true,
          },
          { status: 403 },
        );
        res.cookies.set(
          VERIFY_EMAIL_COOKIE,
          signVerifyEmailCookie(email),
          verifyEmailCookieOptions(),
        );
        return res;
      }
      return NextResponse.json(
        { error: error?.message ?? "Invalid email or password." },
        { status: 401 },
      );
    }

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email ?? null },
    });
  } catch {
    return NextResponse.json({ error: "Sign in failed." }, { status: 500 });
  }
}
