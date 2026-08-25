import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit";

/** 10 MB photo + multipart envelope. Magic-byte check runs in the route. */
const PHOTO_UPLOAD_MAX_CONTENT_LENGTH = 12 * 1024 * 1024;

function getRateLimitTier(pathname: string, method: string) {
  if (
    method === "POST" &&
    (pathname === "/api/onboarding/photo-analysis" ||
      pathname === "/api/avatar/upload")
  ) {
    return RATE_LIMIT_TIERS.photoUpload;
  }
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
  const tier = getRateLimitTier(pathname, request.method);
  if (tier === RATE_LIMIT_TIERS.photoUpload) {
    const len = Number(request.headers.get("content-length"));
    if (Number.isFinite(len) && len > PHOTO_UPLOAD_MAX_CONTENT_LENGTH) {
      return new NextResponse(
        JSON.stringify({ error: "That photo is too large — use one under 10 MB." }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
  }
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
