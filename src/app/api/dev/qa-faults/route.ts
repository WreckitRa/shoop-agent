import {
  clearQaFaultsForConversation,
  listQaFaultsForConversation,
  mergeQaFaultsForConversation,
  parseQaFaultHeader,
  setQaFaultsForConversation,
  type QaFaultSpec,
} from "@/lib/qa/faults";
import { isQaDevEnvironment, qaDevForbiddenResponse } from "@/lib/qa/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function faultsFromBody(body: unknown): QaFaultSpec[] {
  if (!body || typeof body !== "object") return [];
  const faults = (body as { faults?: unknown }).faults;
  if (Array.isArray(faults)) {
    return parseQaFaultHeader(JSON.stringify(faults));
  }
  return [];
}

export async function GET(req: Request) {
  if (!isQaDevEnvironment()) return qaDevForbiddenResponse();

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  if (!conversationId) {
    return Response.json({ error: "conversation_id is required." }, { status: 400 });
  }

  return Response.json({
    conversation_id: conversationId,
    faults: listQaFaultsForConversation(conversationId),
  });
}

export async function POST(req: Request) {
  if (!isQaDevEnvironment()) return qaDevForbiddenResponse();

  let body: { conversation_id?: string; faults?: unknown; merge?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const conversationId = body.conversation_id?.trim();
  if (!conversationId) {
    return Response.json({ error: "conversation_id is required." }, { status: 400 });
  }

  const specs = faultsFromBody(body);
  if (body.merge) mergeQaFaultsForConversation(conversationId, specs);
  else setQaFaultsForConversation(conversationId, specs);

  return Response.json({
    ok: true,
    conversation_id: conversationId,
    faults: listQaFaultsForConversation(conversationId),
  });
}

export async function DELETE(req: Request) {
  if (!isQaDevEnvironment()) return qaDevForbiddenResponse();

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  if (!conversationId) {
    return Response.json({ error: "conversation_id is required." }, { status: 400 });
  }

  clearQaFaultsForConversation(conversationId);
  return Response.json({ ok: true, conversation_id: conversationId });
}
