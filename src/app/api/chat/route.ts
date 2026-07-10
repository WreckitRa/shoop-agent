import { chatPostBodySchema } from "@/lib/ai-chat/validators";
import { createChatSseStream } from "@/lib/ai-chat/run-chat-stream";
import { logAiChat } from "@/lib/ai-chat/observability";
import { kickProductCurationJobWorker } from "@/lib/ai-chat/curation/jobs";
import { kickShoppingMemoryJobWorker } from "@/lib/ai-chat/shopping-memory/jobs";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const raw = await req.json();
    const parsed = chatPostBodySchema.safeParse(raw);
    if (!parsed.success) {
      logAiChat("warn", "chat_validation_failed", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return Response.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const isFashionSend =
      parsed.data.mode === "send" && parsed.data.fashionMode === true;
    if (!isFashionSend) {
      kickShoppingMemoryJobWorker();
      kickProductCurationJobWorker();
    }

    const stream = createChatSseStream({
      body: parsed.data,
      signal: req.signal,
      userId: auth.userId,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable proxy buffering (nginx etc.) so SSE chunks reach the client in real time.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg =
      e instanceof Error && /ANTHROPIC_API_KEY/.test(e.message)
        ? "Anthropic API key is not configured."
        : "Something went wrong.";
    logAiChat("error", "chat_route_failed", { error: e });
    return Response.json({ error: msg }, { status: 500 });
  }
}
