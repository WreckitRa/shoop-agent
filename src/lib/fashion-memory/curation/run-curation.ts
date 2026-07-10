import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { getAnthropicClient } from "@/lib/ai-chat/anthropic";
import { recordPipelineEvent } from "../observability/trace";
import { hashSystemPrompt, upsertPromptVersion } from "../observability/prompt-hash";
import { buildCurationInput } from "./build-input";
import { buildCurationSystemPrompt } from "./prompt";
import {
  DELIVER_CURATION_TOOL,
  extractDeliverCurationBlockDetailed,
  harvestVetoesFromToolContent,
} from "./tool-schema";
import {
  validateCurationOutput,
  nearIdenticalPickWarning,
  isDegradedOutfitPlan,
} from "./validate";
import { buildDeterministicFallback } from "./fallback";
import { buildPresentationContract } from "./presentation";
import {
  FASHION_CURATION_EFFORT,
  FASHION_CURATION_MAX_TOKENS,
  FASHION_CURATION_MODEL,
  CURATION_TOOL_NAME,
  CURATION_LLM_TIMEOUT_MS,
} from "./config";
import { buildFashionCurationDebug } from "./fashion-curation-debug";
import { recordCurationLatencyMs } from "./latency-metrics";
import { sanitizeCurationNarration } from "./narration-sanitize";
import type {
  DeliverCurationInput,
  DeliverCurationVeto,
  FashionCurationResult,
  RunFashionCurationParams,
} from "./types";

function anchorOptionsForPlan(
  plan: RunFashionCurationParams["plan"],
): number {
  const anchor = plan.slots.find((s) => s.role === "anchor");
  return anchor?.options_wanted ?? 2;
}

function perSlotCountsLabel(plan: RunFashionCurationParams["plan"]): string {
  return plan.slots
    .map((s) => `${s.garment}×${s.options_wanted}`)
    .join(", ");
}

function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of active) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

async function callCurationModel(params: {
  traceId?: string | null;
  systemPrompt: string;
  userMessages: import("@anthropic-ai/sdk/resources/messages/messages").MessageCreateParamsNonStreaming["messages"];
  signal?: AbortSignal;
  correctiveHint?: string;
  timeoutMs?: number;
}): Promise<Message> {
  const client = getAnthropicClient();
  const systemPromptHash = hashSystemPrompt(params.systemPrompt);
  upsertPromptVersion({
    hash: systemPromptHash,
    stage: "curation",
    content: params.systemPrompt,
  });

  const messages = params.correctiveHint
    ? [
        ...params.userMessages,
        {
          role: "user" as const,
          content: params.correctiveHint,
        },
      ]
    : params.userMessages;

  const started = Date.now();
  const timeoutMs = params.timeoutMs ?? CURATION_LLM_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = mergeAbortSignals(params.signal, timeoutController.signal);

  try {
    // Non-streaming create() rejects max_tokens that imply >10min wall time
    // (~21k+). Stream + finalMessage keeps 32k headroom for thinking + tool JSON.
    const stream = client.messages.stream(
      {
        model: FASHION_CURATION_MODEL,
        max_tokens: FASHION_CURATION_MAX_TOKENS,
        system: params.systemPrompt,
        messages,
        tools: [DELIVER_CURATION_TOOL],
        // Opus 4.8 adaptive thinking forbids forced tool_choice (any/tool).
        // Medium effort leaves headroom for a complete deliver_curation payload.
        thinking: {
          type: "adaptive",
        },
        output_config: {
          effort: FASHION_CURATION_EFFORT,
        },
      },
      { signal },
    );
    const response = await stream.finalMessage();

    if (params.traceId) {
      const { fashionMemoryDb } = await import("../db");
      void fashionMemoryDb()
        .from("llm_calls")
        .insert({
          trace_id: params.traceId,
          stage: "curation",
          model: FASHION_CURATION_MODEL,
          system_prompt_hash: systemPromptHash,
          input_messages: messages,
          tool_choice: null,
          raw_output: response,
          latency_ms: Date.now() - started,
          input_tokens: response.usage?.input_tokens,
          output_tokens: response.usage?.output_tokens,
        } as never);
    }

    logAiChat("info", "fashion_curation_llm_response", {
      traceId: params.traceId,
      stop_reason: response.stop_reason,
      latency_ms: Date.now() - started,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      block_types: response.content.map((b) => b.type),
      tool_names: response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => (b.type === "tool_use" ? b.name : "")),
      timed_out: false,
    });

    return response;
  } catch (error) {
    const timedOut =
      timeoutController.signal.aborted && !params.signal?.aborted;
    logAiChat("warn", "fashion_curation_llm_failed", {
      traceId: params.traceId,
      error: String(error).slice(0, 400),
      latency_ms: Date.now() - started,
      timed_out: timedOut,
      timeout_ms: timeoutMs,
    });
    throw timedOut
      ? Object.assign(new Error("curation_llm_timeout"), { cause: error })
      : error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * CHOKE POINT: vetoes are product facts. Apply to pool state as soon as any
 * attempt yields them — before retry, before fallback, before presentation.
 * Every subsequent path that produces user-visible picks must read this pool.
 */
async function applyVetoes(params: {
  vetoes: DeliverCurationVeto[];
  registry: import("./types").CurationRefRegistry;
  pools: RunFashionCurationParams["pools"];
  alreadyApplied: Set<string>;
  traceId?: string | null;
}): Promise<Set<string>> {
  const vetoed = new Set<string>();

  for (const veto of params.vetoes) {
    if (params.alreadyApplied.has(veto.ref)) {
      vetoed.add(veto.ref);
      continue;
    }
    vetoed.add(veto.ref);
    params.alreadyApplied.add(veto.ref);
    const entry = params.registry.get(veto.ref);
    if (!entry) continue;

    const pool = params.pools.get(entry.slot_id);
    if (pool) {
      await pool.reportDeath(
        entry.product_id,
        `curator_veto:${veto.reason}`,
        "curation",
      );
    }

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "curator_veto",
      payload: {
        ref: veto.ref,
        product_id: entry.product_id,
        slot_id: entry.slot_id,
        reason: veto.reason,
        evidence: veto.evidence,
        taxonomy_category: entry.candidate.taxonomy_category,
        title: entry.candidate.title,
      },
    });

    if (veto.reason === "wrong_department_visual") {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "department_veto_evidence",
        payload: {
          ref: veto.ref,
          taxonomy_category: entry.candidate.taxonomy_category,
          title: entry.candidate.title,
          variant_options: entry.candidate.variant_options,
        },
      });
    }
  }

  return vetoed;
}

async function harvestAttemptVetoes(params: {
  content?: Message["content"];
  parsed?: DeliverCurationInput | null;
  registry: import("./types").CurationRefRegistry;
  pools: RunFashionCurationParams["pools"];
  alreadyApplied: Set<string>;
  harvested: DeliverCurationVeto[];
  traceId?: string | null;
}): Promise<void> {
  const fromParsed = params.parsed?.vetoes ?? [];
  const fromRaw = params.content
    ? harvestVetoesFromToolContent(params.content)
    : [];
  const byRef = new Map<string, DeliverCurationVeto>();
  for (const v of [...fromParsed, ...fromRaw, ...params.harvested]) {
    if (v.ref) byRef.set(v.ref, v);
  }
  const merged = [...byRef.values()];
  params.harvested.length = 0;
  params.harvested.push(...merged);
  await applyVetoes({
    vetoes: merged,
    registry: params.registry,
    pools: params.pools,
    alreadyApplied: params.alreadyApplied,
    traceId: params.traceId,
  });
}

function lookMembershipFromOutput(
  output: DeliverCurationInput,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const look of output.looks ?? []) {
    for (const ref of look.item_refs) {
      const existing = map.get(ref) ?? [];
      existing.push(look.name);
      map.set(ref, existing);
    }
  }
  return map;
}

function brandFallbackNote(
  slots: RunFashionCurationParams["slots"],
): string | undefined {
  const partial = slots.filter((s) => s.brand_status === "partial");
  const translated = slots.filter((s) => s.brand_status === "translated");
  if (partial.length) {
    return `Only a few confirmed matches for the requested brand — I've kept solid options and noted where inventory is thin.`;
  }
  if (translated.length) {
    return `Couldn't lock every piece to the stated brand — same-spirit alternatives are in the mix.${translated[0]?.brand_sanity_note ? ` ${translated[0].brand_sanity_note}` : ""}`;
  }
  return undefined;
}

function budgetFallbackNote(params: {
  budget_interpretation?: string;
  budget_tension?: RunFashionCurationParams["budget_tension"];
}): string | undefined {
  if (params.budget_interpretation === "per_item_assumed") {
    return "I'm treating your budget as a per-item ceiling unless you meant a total.";
  }
  if (params.budget_tension?.severity === "tight") {
    const lifted = params.budget_tension.slots?.some(
      (s) => s.signal === "lifted",
    );
    return lifted
      ? "Budget was tight for a full set — a few picks sit slightly over the per-slot allocation; they're the closest real options."
      : "Budget was tight for a full set — I leaned on strong basics where the numbers worked.";
  }
  if (params.budget_tension?.severity === "infeasible") {
    return "That total is tight for every piece at once — I kept what still looks right and flagged the squeeze.";
  }
  if (params.budget_tension?.severity === "oversized") {
    return "Your stated budget leaves genuine headroom — the value options honestly compete.";
  }
  return undefined;
}

export async function runFashionCuration(
  params: RunFashionCurationParams,
): Promise<FashionCurationResult> {
  const started = Date.now();
  let retries = 0;
  let fallback = false;
  let imageCount = 0;
  const appliedVetoRefs = new Set<string>();
  const harvestedVetoes: DeliverCurationVeto[] = [];
  const excludedRefs = new Set(params.excludedRefs ?? []);

  const department =
    params.department ??
    params.plan.brief.knowledge_state?.department ??
    params.plan.brief.department_scope ??
    "mixed";

  const systemPrompt = buildCurationSystemPrompt({
    mode: params.plan.mode,
    department,
    occasion_context: params.plan.brief.occasion_context,
    style_direction: params.plan.brief.style_direction,
    options_wanted: params.plan.slots[0]?.options_wanted,
    anchor_options: anchorOptionsForPlan(params.plan),
    per_slot_counts: perSlotCountsLabel(params.plan),
    palette_source: params.plan.slots[0]?.palette_source,
  });

  const inputBundle = await buildCurationInput({
    plan: params.plan,
    slots: params.slots,
    tasteSignals: params.tasteSignals,
    budget_assembly: params.budget_assembly,
    budget_tension: params.budget_tension,
    budget_interpretation: params.budget_interpretation,
    recipientRelation: params.recipientRelation,
    department,
    excludedRefs: [...excludedRefs],
    signal: params.signal,
  });

  imageCount = inputBundle.imageBlocks.length;

  if (inputBundle.images_failed > 0) {
    logAiChat("info", "fashion_curation_images_prepare_partial", {
      traceId: params.traceId,
      failed: inputBundle.images_failed,
      sent: imageCount,
    });
  }

  let rawOutput: DeliverCurationInput | null = null;
  let validationIssues: string[] = [];
  let llmError: string | null = null;
  let parseError: string | null = null;
  let lastToolContent: Message["content"] | undefined;

  const runAttempt = async (opts: {
    userMessages: typeof inputBundle.userMessages;
    correctiveHint?: string;
    omitImagesRebuild?: boolean;
  }) => {
    const response = await callCurationModel({
      traceId: params.traceId,
      systemPrompt,
      userMessages: opts.userMessages,
      signal: params.signal,
      correctiveHint: opts.correctiveHint,
    });
    lastToolContent = response.content;
    const extracted = extractDeliverCurationBlockDetailed(response.content);
    await harvestAttemptVetoes({
      content: response.content,
      parsed: extracted.output,
      registry: inputBundle.registry,
      pools: params.pools,
      alreadyApplied: appliedVetoRefs,
      harvested: harvestedVetoes,
      traceId: params.traceId,
    });
    for (const ref of appliedVetoRefs) excludedRefs.add(ref);
    return extracted;
  };

  try {
    const extracted = await runAttempt({
      userMessages: inputBundle.userMessages,
    });
    rawOutput = extracted.output;
    parseError = extracted.parseError;
    if (!rawOutput) {
      logAiChat("warn", "fashion_curation_missing_tool_use", {
        traceId: params.traceId,
        stop_reason: undefined,
        block_types: lastToolContent?.map((b) => b.type),
        tool_name: extracted.toolName,
        had_tool_use: extracted.hadToolUse,
        parse_error: extracted.parseError,
      });

      if (extracted.hadToolUse) {
        retries += 1;
        // Corrective retry is image-free — images were seen once.
        const textOnly = await buildCurationInput({
          plan: params.plan,
          slots: params.slots,
          tasteSignals: params.tasteSignals,
          budget_assembly: params.budget_assembly,
          budget_tension: params.budget_tension,
          budget_interpretation: params.budget_interpretation,
          recipientRelation: params.recipientRelation,
          department,
          excludedRefs: [...excludedRefs],
          omitImages: true,
          signal: params.signal,
        });
        inputBundle.userMessages = textOnly.userMessages;
        inputBundle.imageBlocks = [];
        inputBundle.textBlock = textOnly.textBlock;
        imageCount = 0;
        try {
          const priorToolJson = lastToolContent
            ? JSON.stringify(
                harvestVetoesFromToolContent(lastToolContent).length
                  ? {
                      note: "prior tool output (partial)",
                      vetoes: harvestVetoesFromToolContent(lastToolContent),
                    }
                  : { parse_error: extracted.parseError },
              )
            : "";
          const retryExtracted = await runAttempt({
            userMessages: inputBundle.userMessages,
            correctiveHint: [
              `Your previous ${CURATION_TOOL_NAME} call failed to parse:`,
              extracted.parseError ?? "unknown schema error",
              priorToolJson ? `Prior vetoes/partial: ${priorToolJson}` : "",
              `Excluded refs (already vetoed — do not pick): ${[...excludedRefs].join(", ") || "(none)"}`,
              `Call ${CURATION_TOOL_NAME} exactly once with valid slots, vetoes (array, may be empty), and narration.opening.`,
              "Images were already reviewed — curate from the text listing. Keep thinking brief.",
            ]
              .filter(Boolean)
              .join("\n"),
          });
          rawOutput = retryExtracted.output;
          parseError = retryExtracted.parseError;
          if (rawOutput) {
            logAiChat("info", "fashion_curation_parse_retry_recovered", {
              traceId: params.traceId,
            });
          } else {
            logAiChat("warn", "fashion_curation_parse_retry_failed", {
              traceId: params.traceId,
              parse_error: retryExtracted.parseError,
              tool_name: retryExtracted.toolName,
            });
          }
        } catch (retryError) {
          logAiChat("warn", "fashion_curation_parse_retry_error", {
            traceId: params.traceId,
            error: String(retryError).slice(0, 240),
          });
        }
      }
    }
  } catch (error) {
    llmError = String(error).slice(0, 400);
    // Timeout / hard fail: still try to harvest from any partial if present.
    if (lastToolContent) {
      await harvestAttemptVetoes({
        content: lastToolContent,
        parsed: null,
        registry: inputBundle.registry,
        pools: params.pools,
        alreadyApplied: appliedVetoRefs,
        harvested: harvestedVetoes,
        traceId: params.traceId,
      });
      for (const ref of appliedVetoRefs) excludedRefs.add(ref);
    }

    // Anthropic many-image 400: retry once text-only so curation still runs.
    if (/image dimensions exceed|many-image/i.test(llmError)) {
      retries += 1;
      const textOnly = await buildCurationInput({
        plan: params.plan,
        slots: params.slots,
        tasteSignals: params.tasteSignals,
        budget_assembly: params.budget_assembly,
        budget_tension: params.budget_tension,
        budget_interpretation: params.budget_interpretation,
        recipientRelation: params.recipientRelation,
        department,
        excludedRefs: [...excludedRefs],
        omitImages: true,
        signal: params.signal,
      });
      inputBundle.userMessages = textOnly.userMessages;
      inputBundle.imageBlocks = [];
      inputBundle.textBlock = textOnly.textBlock;
      imageCount = 0;
      try {
        const retryExtracted = await runAttempt({
          userMessages: inputBundle.userMessages,
          correctiveHint:
            "Images were omitted due to an upstream size limit. Curate from titles, prices, colors, and scores. Call deliver_curation exactly once.",
        });
        rawOutput = retryExtracted.output;
        parseError = retryExtracted.parseError;
        if (rawOutput) llmError = null;
      } catch (retryError) {
        llmError = String(retryError).slice(0, 400);
        logAiChat("warn", "fashion_curation_text_only_retry_failed", {
          traceId: params.traceId,
          error: llmError,
        });
      }
    }
  }

  // If we have a parsed output, merge harvested vetoes into it.
  if (rawOutput && harvestedVetoes.length) {
    const byRef = new Map(rawOutput.vetoes.map((v) => [v.ref, v]));
    for (const v of harvestedVetoes) byRef.set(v.ref, v);
    rawOutput = { ...rawOutput, vetoes: [...byRef.values()] };
  }

  let validated = rawOutput
    ? validateCurationOutput({
        output: rawOutput,
        registry: inputBundle.registry,
        plan: params.plan,
        slots: params.slots,
        excludedRefs: [...excludedRefs],
        budget_assembly: params.budget_assembly,
        budget_tension: params.budget_tension,
        budget_interpretation: params.budget_interpretation,
      })
    : {
        ok: false as const,
        output: null,
        issues: [
          {
            code: llmError
              ? "llm_error"
              : parseError
                ? "tool_parse_error"
                : "no_tool",
            message: llmError
              ? `Curation LLM failed: ${llmError.slice(0, 180)}`
              : parseError
                ? `deliver_curation parse failed: ${parseError.slice(0, 180)}`
                : "Missing deliver_curation",
          },
        ],
      };

  if (!validated.ok && validated.output) {
    retries += 1;
    const reasons = validated.issues.map((i) => i.message).join("; ");
    // Image-free corrective retry with prior vetoes excluded.
    const textOnly = await buildCurationInput({
      plan: params.plan,
      slots: params.slots,
      tasteSignals: params.tasteSignals,
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      recipientRelation: params.recipientRelation,
      department,
      excludedRefs: [...excludedRefs],
      omitImages: true,
      signal: params.signal,
    });
    inputBundle.userMessages = textOnly.userMessages;
    inputBundle.imageBlocks = [];
    imageCount = 0;
    try {
      const retryExtracted = await runAttempt({
        userMessages: inputBundle.userMessages,
        correctiveHint: [
          `Your previous output failed validation: ${reasons}.`,
          `Excluded refs (already vetoed — do not pick): ${[...excludedRefs].join(", ") || "(none)"}`,
          `Call ${CURATION_TOOL_NAME} exactly once. Images already reviewed — use the text listing.`,
        ].join("\n"),
      });
      const retryParsed = retryExtracted.output;
      if (retryParsed) {
        const byRef = new Map(retryParsed.vetoes.map((v) => [v.ref, v]));
        for (const v of harvestedVetoes) byRef.set(v.ref, v);
        validated = validateCurationOutput({
          output: { ...retryParsed, vetoes: [...byRef.values()] },
          registry: inputBundle.registry,
          plan: params.plan,
          slots: params.slots,
          excludedRefs: [...excludedRefs],
          budget_assembly: params.budget_assembly,
          budget_tension: params.budget_tension,
          budget_interpretation: params.budget_interpretation,
        });
      }
    } catch (error) {
      logAiChat("warn", "fashion_curation_retry_failed", {
        traceId: params.traceId,
        error: String(error).slice(0, 240),
      });
    }
  }

  let finalOutput = validated.ok ? validated.output : validated.output;

  if (!validated.ok || !finalOutput) {
    fallback = true;
    // CHOKE POINT: fallback reads live pool state (post-veto deaths).
    finalOutput = buildDeterministicFallback({
      plan: params.plan,
      registry: inputBundle.registry,
      pools: params.pools,
      vetoedRefs: appliedVetoRefs,
      harvestedVetoes,
      thinSlots: [
        ...params.slots.filter((s) => s.thin_slot).map((s) => s.slot_id),
        ...(isDegradedOutfitPlan(params.plan)
          ? params.plan.slots.map((s) => s.slot_id)
          : []),
      ].filter((id, i, arr) => arr.indexOf(id) === i),
      brandNote: brandFallbackNote(params.slots),
      budgetNote: budgetFallbackNote(params),
      traceId: params.traceId,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "curation_fallback",
      payload: {
        reasons: validated.issues.map((i) => i.code),
        vetoes_harvested: harvestedVetoes.length,
      },
    });
  } else {
    // Sanitize LLM narration on the happy path too.
    const plainOpening =
      finalOutput.narration.opening.trim() ||
      "Here are the strongest verified picks for this look.";
    finalOutput = {
      ...finalOutput,
      narration: sanitizeCurationNarration({
        ...finalOutput.narration,
        plainOpening,
        plainThin: finalOutput.narration.thin_note,
        traceId: params.traceId,
      }),
      vetoes: (() => {
        const byRef = new Map(finalOutput!.vetoes.map((v) => [v.ref, v]));
        for (const v of harvestedVetoes) byRef.set(v.ref, v);
        return [...byRef.values()];
      })(),
    };
  }

  validationIssues = validated.issues.map((i) => i.code);

  for (const slotOutput of finalOutput.slots) {
    const warnings = nearIdenticalPickWarning(
      slotOutput.picks,
      inputBundle.registry,
    );
    for (const w of warnings) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: { kind: "near_identical_picks", ...w },
      });
    }
  }

  for (const issue of validated.issues) {
    if (issue.code === "veto_rate_excessive") {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: { kind: "veto_rate_excessive", ...issue },
      });
    }
  }

  for (const pick of finalOutput.slots.flatMap((s) => s.picks)) {
    if (pick.corrected_color) {
      const entry = inputBundle.registry.get(pick.ref);
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "color_correction",
        payload: {
          ref: pick.ref,
          corrected_color: pick.corrected_color,
          listed: entry?.candidate.normalized?.colors?.buckets?.[0],
        },
      });
    }
  }

  // Vetoes already applied during harvest; ensure final set is recorded.
  const vetoedRefs = await applyVetoes({
    vetoes: finalOutput.vetoes,
    registry: inputBundle.registry,
    pools: params.pools,
    alreadyApplied: appliedVetoRefs,
    traceId: params.traceId,
  });

  const looksDroppedBudget =
    (rawOutput?.looks?.length ?? 0) - (finalOutput.looks?.length ?? 0);

  const vetoesByReason: Record<string, number> = {};
  for (const v of finalOutput.vetoes) {
    vetoesByReason[v.reason] = (vetoesByReason[v.reason] ?? 0) + 1;
  }

  const picksPerSlot: Record<string, number> = {};
  for (const s of finalOutput.slots) {
    picksPerSlot[s.slot_id] = s.picks.length;
  }

  const curationMs = Date.now() - started;
  recordCurationLatencyMs(curationMs);

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "curation",
    payload: {
      picks_per_slot: picksPerSlot,
      vetoes_by_reason: vetoesByReason,
      looks_delivered: finalOutput.looks?.length ?? 0,
      looks_dropped_budget: looksDroppedBudget,
      retries,
      fallback,
      ms: curationMs,
      image_count: imageCount,
      validation_issues: validationIssues,
      vetoes_harvested: harvestedVetoes.length,
    },
  });

  const presentation = buildPresentationContract({
    output: finalOutput,
    registry: inputBundle.registry,
    plan: params.plan,
    slots: params.slots,
    vetoedRefs,
    lookMembership: lookMembershipFromOutput(finalOutput),
    budget_tension: params.budget_tension,
    budget_interpretation: params.budget_interpretation,
    fallback,
  });

  const debug = buildFashionCurationDebug({
    plan: params.plan,
    registry: inputBundle.registry,
    presentation,
    input_text: inputBundle.textBlock,
    image_count: imageCount,
    curation_ms: curationMs,
    fallback,
    retries,
    validation_issues: validationIssues,
    raw_llm_output: rawOutput,
    ts: started,
  });

  return {
    presentation,
    curation_ms: curationMs,
    registry: inputBundle.registry,
    debug,
  };
}
