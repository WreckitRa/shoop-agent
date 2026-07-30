/**
 * Stage B voice regression fixtures from trace 0562bba7 + degradation contract.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import {
  buildDeterministicVoiceFallback,
  extractVoiceJson,
  fillCurationVoice,
  isUsableVoice,
  voiceToneAppendix,
} from "../curation/voice";
import {
  CURATION_VOICE_TOOL_NAME,
  STAGE_A_PLACEHOLDER_OPENING,
  STAGE_A_PLACEHOLDER_STYLIST_LINE,
} from "../curation/config";
import { computeDegradation } from "../curation/degradation";
import { buildRenderContract } from "../curation/build-render-contract";
import { NARRATION_MACHINERY_RE } from "../curation/narration-sanitize";
import {
  resetVoiceMetricsForTests,
  voiceMetricsSnapshot,
} from "../observability/voice-metrics";
import type { DeliverCurationInput } from "../curation/types";
import type { FashionCurationPresentation } from "../curation/types";
import type { FashionSearchPlan } from "../search-planner/types";
import type { CurationRefRegistry } from "../curation/types";
import type { TracedLlmCallParams } from "../observability/traced-llm-call";

function toolMsg(
  input: Record<string, unknown>,
  opts?: { stop_reason?: Message["stop_reason"]; output_tokens?: number },
): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "mock",
    stop_reason: opts?.stop_reason ?? "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 200,
      output_tokens: opts?.output_tokens ?? 80,
    },
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: CURATION_VOICE_TOOL_NAME,
        input,
      },
    ],
  } as Message;
}

/** Trace 0562bba7 Stage A → Stage B input shape (3 work tee picks). */
function stageAPlaceholderOutput(): DeliverCurationInput {
  return {
    slots: [
      {
        slot_id: "t-shirt_work",
        picks: [
          {
            ref: "t_shirt_work_2",
            role: "safe",
            stylist_line: STAGE_A_PLACEHOLDER_STYLIST_LINE,
          },
          {
            ref: "t_shirt_work_4",
            role: "stretch",
            stylist_line: STAGE_A_PLACEHOLDER_STYLIST_LINE,
          },
          {
            ref: "t_shirt_work_6",
            role: "value",
            stylist_line: STAGE_A_PLACEHOLDER_STYLIST_LINE,
          },
        ],
      },
    ],
    vetoes: [],
    narration: { opening: STAGE_A_PLACEHOLDER_OPENING },
  };
}

function emptyRegistry(): CurationRefRegistry {
  return {
    get: () => undefined,
  } as unknown as CurationRefRegistry;
}

describe("voice_empty_regression", () => {
  it("rejects truncated/empty tool JSON the way 0562bba7 failed", () => {
    // Reproduces max_tokens truncation mid-tool: empty or missing lines.
    const truncated = toolMsg(
      { opening: "Work-ready tee" },
      { stop_reason: "max_tokens", output_tokens: 300 },
    );
    const parsed = extractVoiceJson(truncated.content);
    assert.equal(isUsableVoice(parsed), false);

    const emptyLines = toolMsg({ opening: "Hi", lines: [] });
    assert.equal(isUsableVoice(extractVoiceJson(emptyLines.content)), false);

    const placeholderOpening = toolMsg({
      opening: STAGE_A_PLACEHOLDER_OPENING,
      lines: [{ ref: "t_shirt_work_2", stylist_line: "Nice knit." }],
    });
    assert.equal(
      isUsableVoice(extractVoiceJson(placeholderOpening.content)),
      false,
    );
  });

  it("accepts a complete Stage B reply for the trace pick count", () => {
    const ok = toolMsg({
      opening: "Work-ready tees — sized and verified for you.",
      lines: [
        {
          ref: "t_shirt_work_2",
          stylist_line: "Clean crew for the office — no logo noise.",
        },
        {
          ref: "t_shirt_work_4",
          stylist_line: "Richer knit if you want the nicer hand.",
        },
        {
          ref: "t_shirt_work_6",
          stylist_line: "Best price of the three — check the hand feel.",
        },
      ],
    });
    assert.equal(isUsableVoice(extractVoiceJson(ok.content)), true);
  });
});

describe("voice_fallback_never_placeholder", () => {
  beforeEach(() => resetVoiceMetricsForTests());

  it("empty voice → templated opening, degradation set, no machinery words", async () => {
    const llmCall = async (_params: TracedLlmCallParams) =>
      toolMsg(
        { opening: "", lines: [] },
        { stop_reason: "max_tokens", output_tokens: 300 },
      );

    const result = await fillCurationVoice({
      output: stageAPlaceholderOutput(),
      registry: emptyRegistry(),
      occasion: "work",
      voiceContext: {
        honesty: "balanced",
        value_philosophy: "best_value,design_first",
      },
      traceId: "0562bba7-0903-47be-9cb4-5ad412c30119",
      llmCall,
    });

    assert.equal(result.voiceFallback, true);
    assert.notEqual(result.output.narration.opening, STAGE_A_PLACEHOLDER_OPENING);
    assert.match(result.output.narration.opening, /work/i);
    assert.equal(
      NARRATION_MACHINERY_RE.test(result.output.narration.opening),
      false,
    );

    for (const pick of result.output.slots[0]!.picks) {
      assert.notEqual(pick.stylist_line, STAGE_A_PLACEHOLDER_STYLIST_LINE);
      assert.ok(pick.stylist_line.length >= 8);
      assert.equal(NARRATION_MACHINERY_RE.test(pick.stylist_line), false);
    }

    const presentation = {
      narration: result.output.narration,
      tiers: { picks: [], verified: [], unverified: [] },
      meta: {
        mode: "single_item" as const,
        thin_slots: [],
        brand_status: {},
        fallback: false,
        voice_fallback: true,
      },
    } satisfies FashionCurationPresentation;

    const plan = {
      mode: "single_item",
      brief: { garments: ["t-shirt"] },
      slots: [{ slot_id: "t-shirt_work" }],
    } as unknown as FashionSearchPlan;

    const deg = computeDegradation({ presentation, plan });
    assert.equal(deg.kind, "voice_fallback");
    assert.equal(deg.user_line, "");

    const render = buildRenderContract({ presentation, plan });
    assert.equal(render.narration.degradation.kind, "voice_fallback");

    const metrics = voiceMetricsSnapshot();
    assert.ok(metrics.fallback >= 1);
    assert.ok(metrics.voice_fallback_rate > 0);
  });

  it("tint survives into fallback variants (blunt vs gentle)", () => {
    const base = stageAPlaceholderOutput();
    const blunt = buildDeterministicVoiceFallback({
      output: base,
      occasion: "work",
      voiceContext: { honesty: "blunt" },
    });
    const gentle = buildDeterministicVoiceFallback({
      output: base,
      occasion: "work",
      voiceContext: { honesty: "gentle" },
    });
    assert.notEqual(blunt.opening, gentle.opening);
    assert.match(blunt.opening!.toLowerCase(), /straight talk|sized/);
    assert.match(gentle.opening!.toLowerCase(), /soft|sized/);
    assert.notEqual(
      blunt.lines![0]!.stylist_line,
      gentle.lines![0]!.stylist_line,
    );
  });
});

describe("voice_retry_recovers", () => {
  beforeEach(() => resetVoiceMetricsForTests());

  it("first empty, retry valid → normal path, no degradation", async () => {
    let calls = 0;
    const llmCall = async (_params: TracedLlmCallParams) => {
      calls += 1;
      if (calls === 1) {
        return toolMsg(
          { opening: "partial" },
          { stop_reason: "max_tokens", output_tokens: 300 },
        );
      }
      return toolMsg({
        opening: "Work-ready picks — sized for you.",
        lines: [
          {
            ref: "t_shirt_work_2",
            stylist_line: "Clean crew, no logo drama.",
          },
          {
            ref: "t_shirt_work_4",
            stylist_line: "Richer hand if you want stretch.",
          },
          {
            ref: "t_shirt_work_6",
            stylist_line: "Value pick — fabric is the only caveat.",
          },
        ],
      });
    };

    const result = await fillCurationVoice({
      output: stageAPlaceholderOutput(),
      registry: emptyRegistry(),
      occasion: "work",
      voiceContext: { honesty: "balanced" },
      llmCall,
    });

    assert.equal(result.voiceFallback, false);
    assert.equal(result.voiceRetried, true);
    assert.equal(calls, 2);
    assert.notEqual(result.output.narration.opening, STAGE_A_PLACEHOLDER_OPENING);
    assert.match(result.output.narration.opening, /Work-ready/);

    const metrics = voiceMetricsSnapshot();
    assert.equal(metrics.fallback, 0);
    assert.ok(metrics.retry_ok >= 1);
  });
});

describe("voice_tone_appendix", () => {
  it("appends honesty + value philosophy for balanced/best_value", () => {
    const suffix = voiceToneAppendix({
      honesty: "balanced",
      value_philosophy: "best_value,design_first",
    });
    assert.match(suffix, /BALANCED/);
    assert.match(suffix, /deal-hunter|value/i);
  });
});
