import { generateSuggestedPrompt, pickFallback } from "@/lib/ai-chat/suggested-prompt";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId")?.trim() || null;

    const auth = await getAuthContext();
    if (!auth.ok) {
      return Response.json({ prompt: pickFallback(Date.now()) });
    }

    const prompt = await generateSuggestedPrompt(auth.userId, conversationId);
    return Response.json({ prompt });
  } catch {
    return Response.json({ prompt: pickFallback(Date.now()) });
  }
}
