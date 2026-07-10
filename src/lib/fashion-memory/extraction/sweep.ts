import { isSupabaseAuthUserId } from "../auth";
import { runFashionExtraction } from "./runner";

/** On-idle / next-visit sweep — captures trailing short answers deferred by the gate. */
export async function sweepFashionExtractionForConversation(params: {
  userId: string;
  conversationId: string;
}) {
  if (!isSupabaseAuthUserId(params.userId)) {
    return { skipped: true, skipReason: "guest_user", ops: [] };
  }
  return runFashionExtraction({
    userId: params.userId,
    conversationId: params.conversationId,
    sweep: true,
  });
}
