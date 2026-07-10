/**
 * Budget-aware search planning — analyze the buyer's budget ceiling before
 * crafting catalog queries so angles match what is realistically purchasable.
 */
import { createLightweightMessage } from "../anthropic";
import {
  AI_CHAT_BUDGET_ANGLE_PLANNER_TIMEOUT_MS,
  AI_CHAT_LIGHTWEIGHT_MODEL,
} from "../constants";
import { logAiChat } from "../observability";
import { withPlannerTimeout } from "./portfolio-planner-shared";
import {
  recordQueryPlannerRun,
  type QueryPlannerDebugHooks,
} from "./query-planner-debug";
import { sanitizeSearchBrief } from "./query-hygiene";
import type { SearchBrief, SearchBriefBudget } from "./types";

export type BudgetSearchAngle = {
  angle: string;
  why: string;
};

const BUDGET_ANGLE_SYSTEM = `You are Shoop's budget-aware search strategist. Given a shopping brief with a budget ceiling, suggest distinct catalog search ANGLES — concrete product types with attribute hooks that realistically fit that budget.

Before answering, think about what product tiers and categories are viable at the upper limit (not luxury above it, not cheap trinkets far below unless the brief wants value picks).

Rules:
- Each angle: a product NOUN + 2–4 attributes (material, tier, use case). No gift/occasion/recipient words.
- Angles must be DISTINCT product categories or tiers — not synonyms.
- Match the budget: a $40 ceiling suggests different products than $400.
- Output ONLY valid JSON, no markdown:
[{"angle":"...","why":"one sentence why this fits the budget"}, ...]`;

/** Upper spending limit in minor units, if any. */
export function budgetUpperLimitCents(budget: SearchBriefBudget): number | null {
  return budget.maxCents ?? budget.amountCents;
}

export function budgetLowerLimitCents(budget: SearchBriefBudget): number | null {
  return budget.minCents ?? null;
}

export function hasBudgetUpperLimit(budget: SearchBriefBudget): boolean {
  return budgetUpperLimitCents(budget) != null && budget.type !== "none";
}

function formatMoney(cents: number, currency: string): string {
  const major = cents / 100;
  const formatted =
    major >= 100
      ? major.toFixed(0)
      : major % 1 === 0
        ? major.toFixed(0)
        : major.toFixed(2);
  return `${currency} ${formatted}`;
}

/** Structured budget block for planner prompts. */
export function buildBudgetPlanningContext(brief: SearchBrief) {
  const b = brief.budget;
  const upper = budgetUpperLimitCents(b);
  const lower = budgetLowerLimitCents(b);
  if (upper == null || b.type === "none") {
    return { has_constraint: false as const };
  }

  const upperLabel = formatMoney(upper, b.currency);
  const lowerLabel = lower != null ? formatMoney(lower, b.currency) : null;

  let band: string;
  if (lowerLabel) {
    band = `${lowerLabel} – ${upperLabel}`;
  } else {
    band = `up to ${upperLabel}`;
  }

  const enforcement =
    b.type === "hard"
      ? "hard cap — products must not exceed the upper limit"
      : "flexible — slight overage OK if clearly worth it";

  return {
    has_constraint: true as const,
    upper_limit: { amount: upper / 100, currency: b.currency, type: b.type },
    lower_limit:
      lower != null
        ? { amount: lower / 100, currency: b.currency }
        : null,
    band,
    enforcement,
    planning_instruction: `Given the ${band} budget (${enforcement}), first decide which product types and quality tiers realistically fit, then craft searches toward those — not luxury above the ceiling or novelty junk far below it unless the brief asks for budget picks.`,
  };
}

export function buildBudgetAngleUserPrompt(
  brief: SearchBrief,
  wantCount: number,
): string {
  const b = sanitizeSearchBrief(brief);
  const budgetCtx = buildBudgetPlanningContext(b);
  return JSON.stringify({
    task: "Suggest budget-viable catalog search angles before query crafting",
    want_angle_count: wantCount,
    seed_query: b.query,
    archetype: b.archetype,
    direction_label: b.directionLabel ?? null,
    category: b.category ?? null,
    use_case: b.useCase ?? null,
    must_haves: b.mustHaves,
    nice_to_haves: b.niceToHaves,
    budget: budgetCtx,
    recipient:
      b.recipient.kind === "other"
        ? {
            label: b.recipient.label ?? null,
            known_interests: b.recipient.knownInterests ?? [],
            age_range: b.recipient.ageRange ?? null,
          }
        : { kind: "self" },
  });
}

function parseBudgetAngleJson(text: string): BudgetSearchAngle[] {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: BudgetSearchAngle[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const angle = typeof o.angle === "string" ? o.angle.trim() : "";
      const why = typeof o.why === "string" ? o.why.trim() : "";
      if (!angle) continue;
      out.push({ angle, why: why || "Fits the stated budget." });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * LLM step: given the budget ceiling, what product search angles are viable?
 * Skipped when there is no upper limit.
 */
export async function planBudgetAwareSearchAngles(
  brief: SearchBrief,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    debug?: QueryPlannerDebugHooks;
    wantCount?: number;
  },
): Promise<BudgetSearchAngle[]> {
  const sanitized = sanitizeSearchBrief(brief);
  if (!hasBudgetUpperLimit(sanitized.budget)) return [];

  const wantCount = options?.wantCount ?? 5;
  const timeoutMs =
    options?.timeoutMs ?? AI_CHAT_BUDGET_ANGLE_PLANNER_TIMEOUT_MS;

  const body = {
    model: AI_CHAT_LIGHTWEIGHT_MODEL,
    max_tokens: 512,
    system: BUDGET_ANGLE_SYSTEM,
    messages: [
      {
        role: "user" as const,
        content: buildBudgetAngleUserPrompt(sanitized, wantCount),
      },
    ],
  };

  const call = createLightweightMessage(body, { signal: options?.signal });

  const msg = await withPlannerTimeout(call, timeoutMs);
  if (!msg) {
    logAiChat("warn", "budget_angle_planner_timeout", {
      query: sanitized.query.slice(0, 120),
      timeoutMs,
    });
    return [];
  }

  recordQueryPlannerRun(body, msg, "budget_angles", options?.debug);

  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const angles = parseBudgetAngleJson(text);
  if (!angles.length) {
    logAiChat("info", "budget_angle_planner_empty", {
      query: sanitized.query.slice(0, 120),
    });
  }
  return angles;
}
