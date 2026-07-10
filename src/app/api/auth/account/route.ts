import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { deleteAllUserData } from "@/lib/auth/delete-user-data";
import { getAuthUser } from "@/lib/auth/session";
import { deleteAccountBodySchema } from "@/lib/auth/validators";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  if (!isSupabaseAuthConfigured()) {
    return Response.json(
      { error: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }

  try {
    const user = await getAuthUser();
    if (!user) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const raw = await req.json();
    const parsed = deleteAccountBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json(
        { error: issue?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const { eraseDataOnly, password } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password,
    });
    if (verifyError) {
      return Response.json({ error: "Incorrect password." }, { status: 401 });
    }

    await deleteAllUserData(user.id);

    if (eraseDataOnly) {
      return Response.json({ ok: true, erasedDataOnly: true });
    }

    const admin = getSupabaseAdminClient();
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(
      user.id,
    );
    if (deleteAuthError) {
      return Response.json({ error: deleteAuthError.message }, { status: 500 });
    }

    await supabase.auth.signOut();

    return Response.json({ ok: true, accountDeleted: true });
  } catch {
    return Response.json({ error: "Could not delete account." }, { status: 500 });
  }
}
