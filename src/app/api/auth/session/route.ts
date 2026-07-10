import { getAuthUser } from "@/lib/auth/session";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseAuthConfigured()) {
    return Response.json({
      configured: false,
      user: null,
    });
  }

  const user = await getAuthUser();
  if (!user) {
    return Response.json({ configured: true, user: null });
  }

  return Response.json({
    configured: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  });
}
