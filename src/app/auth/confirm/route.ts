import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isEmailOtpType } from "@/lib/auth/email-verification";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  isSupabaseAuthConfigured,
} from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = new URL("/", origin);
  const fail = new URL("/?verify=failed", origin);

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(fail);
  }

  const tokenHash = searchParams.get("token_hash");
  const typeRaw = searchParams.get("type");
  if (!tokenHash || !isEmailOtpType(typeRaw)) {
    return NextResponse.redirect(fail);
  }

  const response = NextResponse.redirect(next);
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({
    type: typeRaw,
    token_hash: tokenHash,
  });
  if (error) return NextResponse.redirect(fail);
  return response;
}
