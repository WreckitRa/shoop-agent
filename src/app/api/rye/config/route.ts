import { getRyeEnvironment, getRyeStripePublishableKey, isRyeConfigured } from "@/lib/rye/env";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  if (!isRyeConfigured()) {
    return Response.json({ enabled: false });
  }

  try {
    return Response.json({
      enabled: true,
      environment: getRyeEnvironment(),
      stripePublishableKey: getRyeStripePublishableKey(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Rye is not configured.";
    return Response.json({ enabled: false, error: message }, { status: 503 });
  }
}
