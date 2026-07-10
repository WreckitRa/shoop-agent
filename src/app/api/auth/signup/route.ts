import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { signUpBodySchema } from "@/lib/auth/validators";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSupabaseAuthConfigured()) {
    return Response.json(
      { error: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }

  try {
    const raw = await req.json();
    const parsed = signUpBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json(
        { error: issue?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const admin = getSupabaseAdminClient();

    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const msg = createError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return Response.json(
          { error: "An account with this email already exists. Try signing in." },
          { status: 409 },
        );
      }
      return Response.json({ error: createError.message }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      return Response.json(
        {
          error:
            signInError?.message ??
            "Account created but sign-in failed. Try logging in.",
        },
        { status: 500 },
      );
    }

    return Response.json({
      user: { id: data.user.id, email: data.user.email ?? null },
    });
  } catch {
    return Response.json({ error: "Sign up failed." }, { status: 500 });
  }
}
