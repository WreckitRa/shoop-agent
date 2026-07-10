import { getResumeHint } from "@/lib/ai-chat/resume-hint";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const hint = await getResumeHint(auth.userId);
    return Response.json({ hint });
  } catch {
    return Response.json(
      { error: "Failed to load resume hint." },
      { status: 500 },
    );
  }
}
