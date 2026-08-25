import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isSupabaseAuthConfigured()) {
    return Response.json({ ok: true });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Sign out failed." }, { status: 500 });
  }
}
