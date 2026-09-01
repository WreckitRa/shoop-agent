import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import {
  VERIFY_EMAIL_COOKIE,
  readVerifyEmailCookie,
} from "@/lib/auth/email-verification";
import { prisma } from "@/lib/ai-chat/db";
import { trackProductEvent } from "@/lib/analytics/track";
import { LEGAL_DOC_VERSION } from "@/lib/legal/constants";
import { assertSignupAge } from "@/lib/legal/age-gate";
import { normalizeAgeRange } from "@/lib/onboarding/form-options";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  token: z.string().trim().min(6).max(12),
});

export async function POST(req: Request) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }

  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter the 6-digit code from your email." },
        { status: 400 },
      );
    }

    const { email, token } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const first = await supabase.auth.verifyOtp({
      email,
      token,
      type: "signup",
    });
    const result = first.error
      ? await supabase.auth.verifyOtp({
          email,
          token,
          type: "magiclink",
        })
      : first;

    if (result.error || !result.data.user) {
      return NextResponse.json(
        { error: "That code is wrong or expired. Try again." },
        { status: 401 },
      );
    }

    const jar = await cookies();
    const pending = readVerifyEmailCookie(jar.get(VERIFY_EMAIL_COOKIE)?.value);
    const age =
      pending?.birthDate ? assertSignupAge(pending.birthDate) : null;
    if (age && !age.ok) {
      return NextResponse.json({ error: age.error }, { status: 403 });
    }
    const ageAttested = pending?.ageAttested === true || Boolean(age?.ok);
    if (!ageAttested) {
      return NextResponse.json(
        {
          error:
            "Sign up again so we can confirm you are at least 13.",
        },
        { status: 403 },
      );
    }
    const now = new Date();
    await prisma.userProfile.upsert({
      where: { userId: result.data.user.id },
      create: {
        userId: result.data.user.id,
        ...(age?.ok
          ? {
              birthDate: new Date(`${age.birthDate}T00:00:00.000Z`),
              ageRange: normalizeAgeRange(String(age.ageYears)),
            }
          : {}),
        ageAttestedAt: now,
        termsAcceptedAt: now,
        termsVersion: pending?.termsVersion ?? LEGAL_DOC_VERSION,
      },
      update: {
        ...(age?.ok
          ? {
              birthDate: new Date(`${age.birthDate}T00:00:00.000Z`),
              ageRange: normalizeAgeRange(String(age.ageYears)),
            }
          : {}),
        ageAttestedAt: now,
        termsAcceptedAt: now,
        termsVersion: pending?.termsVersion ?? LEGAL_DOC_VERSION,
      },
    });

    trackProductEvent({
      name: "signup_completed",
      userId: result.data.user.id,
    });

    return NextResponse.json({
      user: {
        id: result.data.user.id,
        email: result.data.user.email ?? null,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not verify email." },
      { status: 500 },
    );
  }
}
