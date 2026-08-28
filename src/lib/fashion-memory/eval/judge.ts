import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "@/lib/fashion-memory/observability/traced-llm-call";
import type { CheckResult } from "./checks";
import { estimateUsdFromTokens, type TokenUsage } from "./cost";
import {
  GRADE_APPOINTMENT_TOOL,
  JUDGE_MODEL,
  buildJudgeSystemPrompt,
  type JudgeGrade,
  type PurchaseDim,
} from "./judge-prompt";
import {
  formatReadyToSearchContent,
  transcriptHasSpokenStylistTurn,
  type PersonaRunResult,
} from "./run-persona";

const JUDGE_MAX_TOKENS = 2500;

export const CELL_DIM_BARS = { not_interrogated: 4.0 } as const;
export const CELL_TRUTH_MATCH_BAR = 0.95;

export type JudgeCallResult = {
  grade: JudgeGrade | null;
  stopReason: string | null;
  usage: TokenUsage;
  usd: number;
  model: string;
};

function purchaseDim(stage: PersonaRunResult["stage"]): PurchaseDim {
  return stage === "full" ? "would_buy" : "would_proceed";
}

function computeOverall(
  g: Omit<JudgeGrade, "overall" | "worst_moment">,
  dim: PurchaseDim,
  opts?: { dropVoice?: boolean },
): number {
  const sharedParts = [
    g.recognized.score,
    g.not_interrogated.score,
    g.no_silent_guess.score,
    ...(opts?.dropVoice || g.voice.score <= 0 ? [] : [g.voice.score]),
  ];
  const shared =
    sharedParts.reduce((a, b) => a + b, 0) / Math.max(1, sharedParts.length);
  const purchase = g[dim].score;
  return (
    g.accuracy.score * 0.25 +
    g.asked_right.score * 0.2 +
    purchase * 0.2 +
    shared * 0.35
  );
}

function buildJudgeUserContent(params: {
  result: PersonaRunResult;
  checks: CheckResult[];
  dim: PurchaseDim;
  dropVoice: boolean;
}): string {
  const transcriptText = params.result.transcript
    .map((t) => {
      const move = t.router?.move ? ` [${t.router.move}]` : "";
      let content = t.content;
      if (
        t.role === "assistant" &&
        (t.router?.move === "ready_to_search" ||
          /\(ready to search\)/i.test(content))
      ) {
        content = formatReadyToSearchContent({
          known_summary:
            t.router && "known_summary" in t.router
              ? (t.router as { known_summary?: string }).known_summary
              : undefined,
          reply: content.replace(/\(ready to search\)/gi, "").trim() || null,
          pull_line:
            t.router && "pull_line" in t.router
              ? (t.router as { pull_line?: string }).pull_line
              : undefined,
        });
      }
      const qs =
        t.router?.move === "ask_clarification"
          ? `\n  Q: ${t.router.questions.map((q) => `${q.gap}:${q.text}`).join(" | ")}`
          : "";
      return `${t.role}${move}: ${content}${qs}`;
    })
    .join("\n");

  return JSON.stringify(
    {
      stage: params.result.stage,
      purchase_dimension: params.dim,
      truth: params.result.persona.truth,
      profile_state: params.result.persona.profile.state,
      language: params.result.persona.language,
      patience: params.result.persona.patience,
      checks: params.checks,
      brief: params.result.brief,
      transcript: transcriptText,
      voice_na: params.dropVoice,
    },
    null,
    2,
  );
}

function extractToolInput(
  msg: Awaited<ReturnType<typeof tracedLLMCall>>,
): Record<string, unknown> | null {
  const blocks = msg.content.filter(
    (b) => b.type === "tool_use" && b.name === "grade_appointment",
  );
  if (!blocks.length) {
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  let best: Record<string, unknown> | null = null;
  let bestKeys = -1;
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    const input = b.input as Record<string, unknown>;
    const keys = Object.keys(input ?? {}).length;
    if (keys > bestKeys) {
      best = input;
      bestKeys = keys;
    }
  }
  return best;
}

function parseScore(
  raw: Record<string, unknown>,
  name: string,
  opts: { allowZero?: boolean },
): { score: number; why: string } | null {
  const flatScore = raw[`${name}_score`];
  const flatWhy = raw[`${name}_why`];
  if (flatScore !== undefined) {
    const n = Number(flatScore);
    if (!Number.isFinite(n)) return null;
    if (opts.allowZero && (n === 0 || flatScore === "n/a" || flatScore === null)) {
      return { score: 0, why: String(flatWhy ?? "n/a").slice(0, 160) };
    }
    if (n < 1 || n > 5 || !Number.isInteger(n)) return null;
    return { score: n, why: String(flatWhy ?? "").slice(0, 160) };
  }

  const v = raw[name];
  if (v && typeof v === "object" && "score" in (v as object)) {
    const o = v as { score?: unknown; why?: unknown };
    const n = Number(o.score);
    if (opts.allowZero && (o.score === 0 || o.score === "n/a" || o.score === null)) {
      return { score: 0, why: String(o.why ?? "n/a").slice(0, 160) };
    }
    if (!Number.isFinite(n) || n < 1 || n > 5 || !Number.isInteger(n)) {
      return null;
    }
    if (typeof o.score === "string" && /<parameter/i.test(o.score)) return null;
    return { score: n, why: String(o.why ?? "").slice(0, 160) };
  }

  return null;
}

function parseGradeFromRaw(params: {
  raw: Record<string, unknown>;
  dim: PurchaseDim;
  dropVoice: boolean;
  model: string;
}): JudgeGrade | null {
  const { raw, dim, dropVoice, model } = params;
  const recognized = parseScore(raw, "recognized", {});
  const asked_right = parseScore(raw, "asked_right", {});
  const not_interrogated = parseScore(raw, "not_interrogated", {});
  const no_silent_guess = parseScore(raw, "no_silent_guess", {});
  const accuracy = parseScore(raw, "accuracy", {});
  const voiceParsed = dropVoice
    ? {
        score: 0,
        why: "n/a — no spoken stylist turn (search progress only)",
      }
    : parseScore(raw, "voice", { allowZero: true });
  const purchase = parseScore(raw, dim, {});

  if (
    !recognized ||
    !asked_right ||
    !not_interrogated ||
    !no_silent_guess ||
    !accuracy ||
    !voiceParsed ||
    !purchase
  ) {
    return null;
  }

  const partial = {
    recognized,
    asked_right,
    not_interrogated,
    no_silent_guess,
    accuracy,
    voice: voiceParsed,
    would_proceed:
      dim === "would_proceed"
        ? purchase
        : { score: 0, why: "n/a full stage" },
    would_buy:
      dim === "would_buy"
        ? purchase
        : { score: 0, why: "n/a router stage" },
  };

  const quote =
    typeof raw.worst_moment_quote === "string"
      ? raw.worst_moment_quote
      : typeof (raw.worst_moment as { quote?: string } | undefined)?.quote ===
          "string"
        ? (raw.worst_moment as { quote: string }).quote
        : "";
  const better =
    typeof raw.worst_moment_better === "string"
      ? raw.worst_moment_better
      : typeof (raw.worst_moment as { better?: string } | undefined)?.better ===
          "string"
        ? (raw.worst_moment as { better: string }).better
        : "";

  const overall = Number.isFinite(Number(raw.overall))
    ? Number(raw.overall)
    : computeOverall(partial, dim, { dropVoice });

  return {
    ...partial,
    overall: Math.round(overall * 100) / 100,
    worst_moment: { quote, better },
    judge_model: model,
  };
}

function readUsage(msg: Awaited<ReturnType<typeof tracedLLMCall>>): TokenUsage {
  return {
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
    cacheReadInputTokens:
      typeof msg.usage?.cache_read_input_tokens === "number"
        ? msg.usage.cache_read_input_tokens
        : undefined,
    cacheCreationInputTokens:
      typeof msg.usage?.cache_creation_input_tokens === "number"
        ? msg.usage.cache_creation_input_tokens
        : undefined,
  };
}

async function callJudgeOnce(params: {
  result: PersonaRunResult;
  checks: CheckResult[];
  traceId: string;
  dim: PurchaseDim;
  dropVoice: boolean;
  model: string;
}): Promise<JudgeCallResult> {
  const msg = await tracedLLMCall({
    traceId: params.traceId,
    stage: "eval_judge",
    model: params.model,
    systemPrompt: buildJudgeSystemPrompt(params.dim),
    disablePromptCache: true,
    maxTokens: JUDGE_MAX_TOKENS,
    tools: [GRADE_APPOINTMENT_TOOL(params.dim) as unknown as never],
    toolChoice: {
      type: "tool",
      name: "grade_appointment",
      disable_parallel_tool_use: true,
    },
    inputMessages: [
      {
        role: "user",
        content: buildJudgeUserContent({
          result: params.result,
          checks: params.checks,
          dim: params.dim,
          dropVoice: params.dropVoice,
        }),
      },
    ],
  });

  const usage = readUsage(msg);
  const usd = estimateUsdFromTokens({ model: params.model, ...usage });
  const raw = extractToolInput(msg);
  if (!raw) {
    return { grade: null, stopReason: msg.stop_reason ?? null, usage, usd, model: params.model };
  }
  const grade = parseGradeFromRaw({
    raw,
    dim: params.dim,
    dropVoice: params.dropVoice,
    model: params.model,
  });
  if (!grade) {
    logAiChat("warn", "eval_judge_invalid_payload", {
      traceId: params.traceId,
      personaId: params.result.persona.id,
      model: params.model,
      stop_reason: msg.stop_reason,
      output_tokens: msg.usage?.output_tokens,
      keys: Object.keys(raw),
      sample: JSON.stringify(raw).slice(0, 400),
    });
  }
  return { grade, stopReason: msg.stop_reason ?? null, usage, usd, model: params.model };
}

async function judgeWithModel(params: {
  result: PersonaRunResult;
  checks: CheckResult[];
  traceId: string;
  model: string;
}): Promise<JudgeCallResult> {
  if (params.result.excluded || params.result.shopper_leak) {
    return {
      grade: null,
      stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      usd: 0,
      model: params.model,
    };
  }

  const dim = purchaseDim(params.result.stage);
  const dropVoice = !transcriptHasSpokenStylistTurn(params.result.transcript);

  const first = await callJudgeOnce({ ...params, dim, dropVoice });
  if (first.grade) return first;

  logAiChat("warn", "eval_judge_retry", {
    traceId: params.traceId,
    personaId: params.result.persona.id,
    model: params.model,
    stop_reason: first.stopReason,
  });

  const second = await callJudgeOnce({ ...params, dim, dropVoice });
  if (second.grade) return second;

  logAiChat("error", "eval_judge_failed", {
    traceId: params.traceId,
    personaId: params.result.persona.id,
    model: params.model,
    stop_reason: second.stopReason,
  });
  return second;
}

/** Opus grades every eligible persona (Sonnet retired — compresses the top). */
export async function judgePersonaRunOpus(params: {
  result: PersonaRunResult;
  checks: CheckResult[];
  traceId: string;
}): Promise<JudgeCallResult> {
  return judgeWithModel({ ...params, model: JUDGE_MODEL });
}

export async function judgePersonaRun(params: {
  result: PersonaRunResult;
  checks: CheckResult[];
  traceId: string;
}): Promise<JudgeGrade | null> {
  const out = await judgePersonaRunOpus(params);
  return out.grade;
}

export function judgeAgreementPct(
  a: JudgeGrade,
  b: JudgeGrade,
): number {
  const dims = [
    "recognized",
    "asked_right",
    "not_interrogated",
    "no_silent_guess",
    "accuracy",
    "voice",
    "would_proceed",
    "would_buy",
  ] as const;
  let match = 0;
  let total = 0;
  for (const d of dims) {
    const x = a[d].score;
    const y = b[d].score;
    if (x <= 0 && y <= 0) continue;
    total++;
    if (x === y) match++;
  }
  if (total === 0) return 100;
  return Math.round((match / total) * 1000) / 10;
}
