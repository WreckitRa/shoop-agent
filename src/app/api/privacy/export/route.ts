import { getAuthContext } from "@/lib/auth/session";
import { exportUserData } from "@/lib/legal/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const data = await exportUserData(auth.userId);
  data.account.email = auth.email;

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="shoop-data-${auth.userId.slice(0, 8)}.json"`,
    },
  });
}
