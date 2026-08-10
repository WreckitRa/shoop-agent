import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { getAnthropicClient } from "@/lib/ai-chat/anthropic";
import { consumeQaFault, hasQaFault } from "@/lib/qa/faults";
import { recordPipelineEvent } from "../observability/trace";
import { withTracedLlmCall } from "../observability/traced-llm-call";
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
import {
  buildDeterministicFallback,
  validateAndRepairFallback,
  synthesizeOutfitLooks,
} from "./fallback";
import { buildPresentationContract } from "./presentation";
import {
  FASHION_CURATION_EFFORT,
  FASHION_CURATION_MAX_TOKENS,
  FASHION_CURATION_MODEL,
  CURATION_TOOL_NAME,
  CURATION_LLM_TIMEOUT_MS,
  CURATION_LATENCY_TRIPWIRE_MS,
  STAGE_A_PLACEHOLDER_OPENING,
  STAGE_A_PLACEHOLDER_STYLIST_LINE,
} from "./config";
import {
  CURATION_HARD_MS,
  CURATION_SHRINK_RETRY_MS,
  CURATION_STAGE_A_HARD_MS,
  CURATION_STAGE_A_SHRINK_MS,
  FASHION_CURATION_SPLIT_ENABLED,
} from "../pipeline-cutoffs";
import { recordCurationLatencyMs, recordCurationLlmCallMs, curationLlmCallLatencySnapshot } from "./latency-metrics";
import { sanitizeCurationNarration } from "./narration-sanitize";
import { fillCurationVoice } from "./voice";
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
  attempt?: string;
  createMessage?: RunFashionCurationParams["createMessage"];
}): Promise<Message> {
  if (params.createMessage) {
    return params.createMessage({
      traceId: params.traceId,
      systemPrompt: params.systemPrompt,
      userMessages: params.userMessages,
      signal: params.signal,
      correctiveHint: params.correctiveHint,
      timeoutMs: params.timeoutMs,
    });
  }

  if (hasQaFault(null, "force_curation_timeout")) {
    consumeQaFault(null, "force_curation_timeout", params.traceId);
    const err = Object.assign(new Error("curation_llm_timeout"), {
      cause: new Error("qa_fault:force_curation_timeout"),
    });
    logAiChat("warn", "fashion_curation_llm_failed", {
      traceId: params.traceId,
      error: String(err).slice(0, 400),
      latency_ms: 0,
      timed_out: true,
      timeout_ms: params.timeoutMs ?? CURATION_LLM_TIMEOUT_MS,
      qa_fault: true,
    });
    throw err;
  }

  const client = getAnthropicClient();

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
  const configuredTimeout =
    params.timeoutMs ?? CURATION_LLM_TIMEOUT_MS;
  const timeoutMs = configuredTimeout > 0 ? configuredTimeout : null;
  const timeoutController = timeoutMs ? new AbortController() : null;
  const timer =
    timeoutMs && timeoutController
      ? setTimeout(() => timeoutController.abort(), timeoutMs)
      : null;
  const signal = mergeAbortSignals(
    params.signal,
    timeoutController?.signal,
  );

  let tripwireFired = false;
  const tripwireTimer =
    CURATION_LATENCY_TRIPWIRE_MS > 0
      ? setTimeout(() => {
          tripwireFired = true;
          logAiChat("warn", "fashion_curation_tripwire", {
            traceId: params.traceId,
            attempt: params.attempt ?? "primary",
            tripwire_ms: CURATION_LATENCY_TRIPWIRE_MS,
          });
        }, CURATION_LATENCY_TRIPWIRE_MS)
      : null;

  const logLlmTiming = (timedOut: boolean) => {
    const latencyMs = Date.now() - started;
    recordCurationLlmCallMs(latencyMs);
    const stats = curationLlmCallLatencySnapshot();
    logAiChat("info", "fashion_curation_llm_timing", {
      traceId: params.traceId,
      attempt: params.attempt ?? "primary",
      latency_ms: latencyMs,
      timed_out: timedOut,
      timeout_ms: timeoutMs,
      tripwire_fired: tripwireFired,
      sample_count: stats.count,
      p50_ms: stats.p50_ms,
      p90_ms: stats.p90_ms,
      p99_ms: stats.p99_ms,
      max_ms: stats.max_ms,
    });
  };

  const thinkingEffort: "low" | "medium" | "high" | null =
    FASHION_CURATION_EFFORT === "low" ||
    FASHION_CURATION_EFFORT === "medium" ||
    FASHION_CURATION_EFFORT === "high"
      ? FASHION_CURATION_EFFORT
      : null;
  const useThinking = thinkingEffort != null;

  try {
    const response = await withTracedLlmCall<Message>({
      traceId: params.traceId,
      stage: "curation",
      model: FASHION_CURATION_MODEL,
      systemPrompt: params.systemPrompt,
      inputMessages: messages,
      toolChoice: useThinking
        ? null
        : { type: "tool", name: CURATION_TOOL_NAME },
      execute: async () => {
        const base = {
          model: FASHION_CURATION_MODEL,
          max_tokens: FASHION_CURATION_MAX_TOKENS,
          system: [
            {
              type: "text" as const,
              text: params.systemPrompt,
              // 5-min ephemeral cache — house rules + mode sections reuse in-session.
              cache_control: { type: "ephemeral" as const },
            },
          ],
          messages,
          tools: [DELIVER_CURATION_TOOL],
        };

        // Stream only when thinking needs headroom; otherwise plain create is faster.
        if (useThinking && thinkingEffort) {
          const stream = client.messages.stream(
            {
              ...base,
              thinking: { type: "adaptive" as const },
              output_config: { effort: thinkingEffort },
            },
            { signal },
          );
          const msg = await stream.finalMessage();
          return {
            value: msg,
            rawOutput: msg,
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
          };
        }

        const msg = await client.messages.create(
          {
            ...base,
            tool_choice: {
              type: "tool" as const,
              name: CURATION_TOOL_NAME,
            },
          },
          { signal },
        );
        return {
          value: msg,
          rawOutput: msg,
          inputTokens: msg.usage?.input_tokens,
          outputTokens: msg.usage?.output_tokens,
        };
      },
    });

    const usage = response.usage;

    logAiChat("info", "fashion_curation_llm_response", {
      traceId: params.traceId,
      stop_reason: response.stop_reason,
      latency_ms: Date.now() - started,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      cache_read_input_tokens: (
        usage as { cache_read_input_tokens?: number } | undefined
      )?.cache_read_input_tokens,
      cache_creation_input_tokens: (
        usage as { cache_creation_input_tokens?: number } | undefined
      )?.cache_creation_input_tokens,
      block_types: response.content.map((b) => b.type),
      tool_names: response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => (b.type === "tool_use" ? b.name : "")),
      timed_out: false,
      tripwire_fired: tripwireFired,
      thinking: useThinking,
      attempt: params.attempt ?? "primary",
    });

    logLlmTiming(false);

    return response;
  } catch (error) {
    const timedOut = Boolean(
      timeoutController?.signal.aborted && !params.signal?.aborted,
    );
    logLlmTiming(timedOut);
    logAiChat("warn", "fashion_curation_llm_failed", {
      traceId: params.traceId,
      error: String(error).slice(0, 400),
      latency_ms: Date.now() - started,
      timed_out: timedOut,
      timeout_ms: timeoutMs,
      attempt: params.attempt ?? "primary",
    });
    throw timedOut
      ? Object.assign(new Error("curation_llm_timeout"), { cause: error })
      : error;
  } finally {
    if (timer) clearTimeout(timer);
    if (tripwireTimer) clearTimeout(tripwireTimer);
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
  budget_max?: number;
}): string | undefined {
  if (params.budget_interpretation === "per_item_stated") {
    const max = params.budget_max;
    return max != null
      ? `Keeping each piece under $${Math.round(max)}.`
      : "Keeping each piece under your stated per-item budget.";
  }
  if (params.budget_interpretation === "per_item_assumed") {
    return "I'm treating your budget as a per-item ceiling unless you meant a total.";
  }
  if (params.budget_interpretation === "total_stated") {
    const max = params.budget_max;
    return max != null
      ? `Working within your $${Math.round(max)} total.`
      : "Working within your stated total budget.";
  }
  if (params.budget_interpretation === "set_total_assumed") {
    const max = params.budget_max;
    return max != null
      ? `Treating ~$${Math.round(max)} as coverage across the full set.`
      : "Treating your budget as coverage across the full set.";
  }
  if (params.budget_tension?.severity === "tight") {
    const lifted = params.budget_tension.slots?.some(
      (s) => s.signal === "lifted",
    );
    return lifted
      ? "Budget was tight for a full set — a few picks sit slightly over what each piece could take; they're the closest real options."
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

  const systemPromptBase = buildCurationSystemPrompt({
    mode: params.plan.mode,
    department,
    occasion_context: params.plan.brief.occasion_context,
    style_direction: params.plan.brief.style_direction,
    options_wanted: params.plan.slots[0]?.options_wanted,
    anchor_options: anchorOptionsForPlan(params.plan),
    per_slot_counts: perSlotCountsLabel(params.plan),
    palette_source: params.plan.slots[0]?.palette_source,
  });

  const systemPrompt = FASHION_CURATION_SPLIT_ENABLED
    ? `${systemPromptBase}

PHASE PICK (Stage A): Spend tokens on correct refs, roles, looks, and vetoes.
Set every stylist_line to exactly "${STAGE_A_PLACEHOLDER_STYLIST_LINE}" and narration.opening to
"${STAGE_A_PLACEHOLDER_OPENING}" — a later voice pass fills real prose. Do not write
long narration here.
OUTFIT MODE (required): include looks[] with exactly the named looks the mode
section asks for. Each look needs item_refs spanning the slots. Omitting looks
is a contract failure — never return slots without looks in outfit mode.`
    : systemPromptBase;

  if (params.deterministicOnly) {
    // Rung 4 — no LLM; deterministic looks synthesis.
    const inputBundle = await buildCurationInput({
      plan: params.plan,
      slots: params.slots,
      tasteSignals: params.tasteSignals,
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      recipientRelation: params.recipientRelation,
      department,
      recipientProfile: params.recipientProfile,
      excludedRefs: [...excludedRefs],
      omitImages: true,
      signal: params.signal,
    });
    imageCount = 0;
    fallback = true;
    const brandNote = brandFallbackNote(params.slots);
    const budgetNote = budgetFallbackNote({
      ...params,
      budget_max: params.plan.brief.budget_context.max,
    });
    const thinSlots = [
      ...params.slots.filter((s) => s.thin_slot).map((s) => s.slot_id),
      ...(isDegradedOutfitPlan(params.plan)
        ? params.plan.slots.map((s) => s.slot_id)
        : []),
    ].filter((id, i, arr) => arr.indexOf(id) === i);
    const rawFallback = buildDeterministicFallback({
      plan: params.plan,
      registry: inputBundle.registry,
      pools: params.pools,
      vetoedRefs: appliedVetoRefs,
      harvestedVetoes,
      thinSlots,
      brandNote,
      budgetNote,
      traceId: params.traceId,
    });
    const repaired = validateAndRepairFallback({
      output: rawFallback,
      registry: inputBundle.registry,
      plan: params.plan,
      slots: params.slots,
      excludedRefs: [...excludedRefs],
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      brandNote,
      budgetNote,
      thinNote: rawFallback.narration.thin_note,
      traceId: params.traceId,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "curation_fallback",
      payload: {
        reasons: ["deterministic_rung"],
        looks_delivered: repaired.output.looks?.length ?? 0,
      },
    });
    recordCurationLatencyMs(Date.now() - started);
    const curationMs = Date.now() - started;
    const presentation = buildPresentationContract({
      output: repaired.output,
      registry: inputBundle.registry,
      plan: params.plan,
      slots: params.slots,
      vetoedRefs: appliedVetoRefs,
      lookMembership: lookMembershipFromOutput(repaired.output),
      fallback: true,
      traceId: params.traceId,
    });
    return {
      presentation,
      curation_ms: curationMs,
      registry: inputBundle.registry,
    };
  }

  const inputBundle = await buildCurationInput({
    plan: params.plan,
    slots: params.slots,
    tasteSignals: params.tasteSignals,
    budget_assembly: params.budget_assembly,
    budget_tension: params.budget_tension,
    budget_interpretation: params.budget_interpretation,
    recipientRelation: params.recipientRelation,
    department,
    recipientProfile: params.recipientProfile,
    excludedRefs: [...excludedRefs],
    omitImages: params.omitImages,
    imageBudgetScale: params.imageBudgetScale,
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
  /** Law: never retry the same oversized call — at most ONE shrink/parse retry. */
  let usedRetry = false;

  const rebuildInput = async (opts: {
    omitImages?: boolean;
    imageBudgetScale?: number;
  }) => {
    const next = await buildCurationInput({
      plan: params.plan,
      slots: params.slots,
      tasteSignals: params.tasteSignals,
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      recipientRelation: params.recipientRelation,
      department,
      recipientProfile: params.recipientProfile,
      excludedRefs: [...excludedRefs],
      omitImages: opts.omitImages,
      imageBudgetScale: opts.imageBudgetScale,
      signal: params.signal,
    });
    inputBundle.userMessages = next.userMessages;
    inputBundle.imageBlocks = next.imageBlocks;
    inputBundle.textBlock = next.textBlock;
    // Keep original registry for ref stability; image_shown already decided.
    imageCount = next.imageBlocks.length;
    return next;
  };

  const runAttempt = async (opts: {
    userMessages: typeof inputBundle.userMessages;
    correctiveHint?: string;
    attempt?: string;
    timeoutMs?: number;
  }) => {
    if (params.resolveCurationMessage && !opts.correctiveHint) {
      const response = await params.resolveCurationMessage({
        registry: inputBundle.registry,
        plan: params.plan,
        slots: params.slots,
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
    }

    if (hasQaFault(null, "force_curation_invalid")) {
      const { buildForceInvalidCurationMessage } = await import("@/lib/qa/curation-fault");
      const vetoRef = [...inputBundle.registry.keys()][1] ?? [...inputBundle.registry.keys()][0];
      if (vetoRef) {
        consumeQaFault(null, "force_curation_invalid", params.traceId, {
          veto_ref: vetoRef,
        });
        const response = buildForceInvalidCurationMessage(vetoRef);
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
      }
    }

    const response = await callCurationModel({
      traceId: params.traceId,
      systemPrompt,
      userMessages: opts.userMessages,
      signal: params.signal,
      correctiveHint: opts.correctiveHint,
      attempt: opts.attempt,
      timeoutMs: opts.timeoutMs,
      createMessage: params.createMessage,
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

  const primaryTimeoutMs =
    params.timeoutMs ??
    (FASHION_CURATION_SPLIT_ENABLED
      ? CURATION_STAGE_A_HARD_MS
      : CURATION_HARD_MS);
  const shrinkTimeoutMs = FASHION_CURATION_SPLIT_ENABLED
    ? CURATION_STAGE_A_SHRINK_MS
    : CURATION_SHRINK_RETRY_MS;

  try {
    const extracted = await runAttempt({
      userMessages: inputBundle.userMessages,
      attempt: "primary",
      timeoutMs: primaryTimeoutMs,
    });
    rawOutput = extracted.output;
    parseError = extracted.parseError;
    if (!rawOutput && extracted.hadToolUse && !usedRetry) {
      usedRetry = true;
      retries += 1;
      // Parse fail → ONE retry, text-only (half images → zero).
      await rebuildInput({ omitImages: true });
      try {
        const retryExtracted = await runAttempt({
          userMessages: inputBundle.userMessages,
          attempt: "parse_retry",
          timeoutMs: shrinkTimeoutMs,
          correctiveHint: [
            `Your previous ${CURATION_TOOL_NAME} call failed to parse:`,
            extracted.parseError ?? "unknown schema error",
            `Excluded refs (already vetoed — do not pick): ${[...excludedRefs].join(", ") || "(none)"}`,
            `Call ${CURATION_TOOL_NAME} exactly once with valid slots, vetoes, and narration.opening.`,
            "Images were already reviewed — curate from the text listing.",
          ].join("\n"),
        });
        rawOutput = retryExtracted.output;
        parseError = retryExtracted.parseError;
        if (rawOutput) {
          logAiChat("info", "fashion_curation_parse_retry_recovered", {
            traceId: params.traceId,
          });
        }
      } catch (retryError) {
        logAiChat("warn", "fashion_curation_parse_retry_error", {
          traceId: params.traceId,
          error: String(retryError).slice(0, 240),
        });
      }
    }
  } catch (error) {
    llmError = String(error).slice(0, 400);
    const timedOut = /curation_llm_timeout/i.test(llmError);
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

    // Latency law: never retry the SAME call — shrink images once, shorter budget.
    if (!usedRetry && (timedOut || /image dimensions exceed|many-image/i.test(llmError))) {
      usedRetry = true;
      retries += 1;
      const shrinkScale = timedOut ? 0.5 : undefined;
      await rebuildInput({
        omitImages: !timedOut,
        imageBudgetScale: shrinkScale,
      });
      try {
        const retryExtracted = await runAttempt({
          userMessages: inputBundle.userMessages,
          attempt: timedOut ? "shrink_retry" : "image_size_retry",
          timeoutMs: shrinkTimeoutMs,
          correctiveHint: timedOut
            ? `Prior call timed out. Call ${CURATION_TOOL_NAME} once with fewer/terser picks. Images halved.`
            : "Images omitted due to size limit. Curate from titles, prices, colors, and scores.",
        });
        rawOutput = retryExtracted.output;
        parseError = retryExtracted.parseError;
        if (rawOutput) llmError = null;
        logAiChat("info", "fashion_curation_shrink_retry", {
          traceId: params.traceId,
          timed_out: timedOut,
          recovered: Boolean(rawOutput),
          images: imageCount,
        });
      } catch (retryError) {
        llmError = String(retryError).slice(0, 400);
        logAiChat("warn", "fashion_curation_shrink_retry_failed", {
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

  if (!validated.ok && validated.output && !usedRetry) {
    usedRetry = true;
    retries += 1;
    const reasons = validated.issues.map((i) => i.message).join("; ");
    // ONE validation retry — text-only, shrink budget.
    await rebuildInput({ omitImages: true });
    try {
      const retryExtracted = await runAttempt({
        userMessages: inputBundle.userMessages,
        attempt: "validation_retry",
        timeoutMs: shrinkTimeoutMs,
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
          deterministicBudgetSwap: true,
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
    const brandNote = brandFallbackNote(params.slots);
    const budgetNote = budgetFallbackNote({
      ...params,
      budget_max: params.plan.brief.budget_context.max,
    });
    const thinSlots = [
      ...params.slots.filter((s) => s.thin_slot).map((s) => s.slot_id),
      ...(isDegradedOutfitPlan(params.plan)
        ? params.plan.slots.map((s) => s.slot_id)
        : []),
    ].filter((id, i, arr) => arr.indexOf(id) === i);

    const rawFallback = buildDeterministicFallback({
      plan: params.plan,
      registry: inputBundle.registry,
      pools: params.pools,
      vetoedRefs: appliedVetoRefs,
      harvestedVetoes,
      thinSlots,
      brandNote,
      budgetNote,
      traceId: params.traceId,
    });

    // CHOKE POINT: every path producing user-visible picks exits through
    // validateCurationOutput (via validateAndRepairFallback).
    const repaired = validateAndRepairFallback({
      output: rawFallback,
      registry: inputBundle.registry,
      plan: params.plan,
      slots: params.slots,
      excludedRefs: [...excludedRefs],
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      brandNote,
      budgetNote,
      thinNote: rawFallback.narration.thin_note,
      traceId: params.traceId,
    });
    finalOutput = repaired.output;
    validated = {
      ok: true,
      output: repaired.output,
      issues: repaired.issues.map((code) => ({ code, message: code })),
    };

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "curation_fallback",
      payload: {
        reasons: validated.issues.map((i) => i.code),
        vetoes_harvested: harvestedVetoes.length,
        degraded: repaired.degraded,
      },
    });
  } else {
    // Sanitize LLM narration on the happy path too.
    // CHOKE POINT: every path producing user-visible picks exits through
    // validateCurationOutput (already passed above).
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

  // Outfit contract: looks.length === 0 is a structure failure. Stage A sometimes
  // returns picks-only (trace 2ace97ce) — synthesize named combos from the rack.
  let looksSynthesized = false;
  if (
    finalOutput &&
    params.plan.mode === "outfit" &&
    !(finalOutput.looks?.length)
  ) {
    const synthesized = synthesizeOutfitLooks({
      slots: finalOutput.slots,
      registry: inputBundle.registry,
    });
    if (synthesized.length > 0) {
      finalOutput = { ...finalOutput, looks: synthesized };
      looksSynthesized = true;
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "looks_synthesized",
        payload: {
          count: synthesized.length,
          reason: "outfit_looks_missing_after_stage_a",
        },
      });
      logAiChat("warn", "fashion_curation_looks_synthesized", {
        traceId: params.traceId,
        count: synthesized.length,
      });
    }
  }

  // Phase 1 Stage B: fill voice onto already-chosen picks (text-only, cheap model).
  let voiceFallback = false;
  if (FASHION_CURATION_SPLIT_ENABLED && finalOutput && !fallback) {
    const voiceResult = await fillCurationVoice({
      output: finalOutput,
      registry: inputBundle.registry,
      recipientProfile: params.recipientProfile,
      occasion: params.plan.brief.occasion_context,
      styleDirection: params.plan.brief.style_direction,
      voiceContext: params.plan.brief.voice_context,
      signal: params.signal,
      traceId: params.traceId,
    });
    finalOutput = voiceResult.output;
    voiceFallback = voiceResult.voiceFallback;
  }

  validationIssues = validated.issues.map((i) => i.code);
  if (looksSynthesized) validationIssues.push("looks_synthesized");

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
  const llmCallStats = curationLlmCallLatencySnapshot();

  logAiChat("info", "fashion_curation_stage_complete", {
    traceId: params.traceId,
    stage_ms: curationMs,
    retries,
    fallback,
    llm_call_stats: llmCallStats,
  });

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
      llm_call_stats: llmCallStats,
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
    voice_fallback: voiceFallback,
    traceId: params.traceId,
  });
  return {
    presentation,
    curation_ms: curationMs,
    registry: inputBundle.registry,
  };
}
