import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "../observability/traced-llm-call";
import type { FashionExtractionContext } from "./assemble-context";
import {
  buildFashionExtractionPrompt,
  buildFashionExtractionUserMessage,
} from "./prompt";
import {
  RECORD_FASHION_OPS_TOOL,
  RECORD_FASHION_OPS_TOOL_NAME,
  parseRecordFashionOpsResult,
  type RecordFashionOpsResult,
} from "./tool-schema";
import { FASHION_EXTRACTOR_MODEL } from "../models";

function parseToolInput(raw: unknown): RecordFashionOpsResult {
  const parsed = parseRecordFashionOpsResult(raw);
  if (parsed.recoveredPartially || parsed.issues.length > 0) {
    logAiChat("warn", "fashion_extraction_tool_schema_mismatch", {
      issues: parsed.issues,
      dropped_ops: parsed.droppedOps,
      dropped_ambiguous: parsed.droppedAmbiguous,
      kept_ops: parsed.result.ops.length,
      kept_ambiguous: parsed.result.ambiguous_subjects.length,
    });
  }
  return parsed.result;
}

export async function extractFashionMemoryFromTurn(params: {
  context: FashionExtractionContext;
  signal?: AbortSignal;
  traceId?: string | null;
}): Promise<RecordFashionOpsResult> {
  if (!params.context.messages.trim() || params.context.messages === "(no messages)") {
    return { ops: [], ambiguous_subjects: [] };
  }

  const response = await tracedLLMCall({
    traceId: params.traceId,
    stage: "extraction",
    model: FASHION_EXTRACTOR_MODEL,
    maxTokens: 4096,
    temperature: 0,
    systemPrompt: buildFashionExtractionPrompt(),
    inputMessages: [
      {
        role: "user",
        content: buildFashionExtractionUserMessage(params.context),
      },
    ],
    tools: [RECORD_FASHION_OPS_TOOL],
    toolChoice: { type: "tool", name: RECORD_FASHION_OPS_TOOL_NAME },
    signal: params.signal,
  });

  const toolBlock = response.content.find(
    (block) =>
      block.type === "tool_use" && block.name === RECORD_FASHION_OPS_TOOL_NAME,
  );

  if (!toolBlock || toolBlock.type !== "tool_use") {
    logAiChat("warn", "fashion_extraction_missing_tool_use", {
      stopReason: response.stop_reason,
    });
    return { ops: [], ambiguous_subjects: [] };
  }

  return parseToolInput(toolBlock.input);
}
