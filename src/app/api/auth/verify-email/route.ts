import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";

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
