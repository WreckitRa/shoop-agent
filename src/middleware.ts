import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit";

function getRateLimitTier(pathname: string) {
  if (/^\/api\/auth\//.test(pathname)) return RATE_LIMIT_TIERS.auth;
  if (/^\/api\/chat($|\/)/.test(pathname)) return RATE_LIMIT_TIERS.chat;
  if (/^\/api\/cart($|\/)/.test(pathname)) return RATE_LIMIT_TIERS.cart;
  if (
    /^\/api\/(profile|onboarding|conversations|messages)($|\/)/.test(pathname)
  )
    return RATE_LIMIT_TIERS.profile;
  if (/^\/api\//.test(pathname)) return RATE_LIMIT_TIERS.general;
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit all API routes before any auth or route handling.
  const tier = getRateLimitTier(pathname);
  if (tier) {
    const result = checkRateLimit(request, tier);
    if (!result.ok) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests. Please slow down." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(result.retryAfter),
          },
        },
      );
    }
  }

  let response = NextResponse.next({ request });

  // Supabase session refresh (cookie propagation).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
