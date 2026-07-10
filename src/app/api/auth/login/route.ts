import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { signInBodySchema } from "@/lib/auth/validators";
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
    const parsed = signInBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json(
        { error: issue?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return Response.json(
        { error: error?.message ?? "Invalid email or password." },
        { status: 401 },
      );
    }

    return Response.json({
      user: { id: data.user.id, email: data.user.email ?? null },
    });
  } catch {
    return Response.json({ error: "Sign in failed." }, { status: 500 });
  }
}
