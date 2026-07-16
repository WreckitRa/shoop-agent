import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { CURATION_TOOL_NAME } from "@/lib/fashion-memory/curation/config";

/**
 * Canned invalid deliver_curation output: schema-invalid overall but contains
 * one harvestable veto (exercises harvestVetoesFromToolContent path).
 */
export function buildForceInvalidCurationMessage(vetoRef: string): Message {
  return {
    id: "qa_fault_invalid_curation",
    type: "message",
    role: "assistant",
    model: "qa-fault",
    stop_reason: "tool_use",
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [
      {
        type: "tool_use",
        id: "qa_invalid_tool",
        name: CURATION_TOOL_NAME,
        input: {
          slots: [
            {
              slot_id: "qa_fault_slot",
              picks: [],
            },
          ],
          vetoes: [
            {
              ref: vetoRef,
              reason: "wrong_item_type",
              evidence:
                "QA fault injection: image shows wrong garment type for slot",
            },
          ],
          narration: { opening: "bad" },
        },
      },
    ],
  } as Message;
}
