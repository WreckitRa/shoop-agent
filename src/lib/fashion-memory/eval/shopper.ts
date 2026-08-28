import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";
import { tracedLLMCall } from "@/lib/fashion-memory/observability/traced-llm-call";
import type {
  FashionClarificationQuestion,
  FashionRouterResult,
} from "@/lib/fashion-memory/router/types";
import { optionLabels } from "@/lib/fashion-memory/router/clarification-defaults";
import { parseSlotsClarificationAnswer } from "@/lib/fashion-memory/intake/apply-intake-reply";
import {
  formatPullSheetPart,
  PULL_SHEET_JOIN,
} from "@/lib/fashion-memory/router/pull-sheet";
import { familiesMatchDeterministic } from "./garment-family";
import type { Persona } from "./persona";
import { buildShopperSystemPrompt } from "./shopper-prompt";

/** Shopper simulator — Haiku (cost). */
export const EVAL_SHOPPER_MODEL = AI_CHAT_LIGHTWEIGHT_MODEL;

export type ShopperLeak = {
  fact: string;
  evidence: string;
};

function optionLabel(opt: string | { label: string }): string {
  return typeof opt === "string" ? opt : opt.label;
}

function familiesCover(a: string, b: string): boolean {
  return familiesMatchDeterministic(a, b);
}

/** Wanted garments = truth.garments − owns. */
export function truthWantedGarments(persona: Persona): string[] {
  const owns = new Set(persona.truth.owns.map((o) => o.toLowerCase()));
  return persona.truth.garments.filter((g) => !owns.has(g.toLowerCase()));
}

/** Deterministic depth chip from persona truth. */
function truthDepthChip(persona: Persona): string | null {
  const d = persona.truth.depth;
  if (d === "you_decide") return "You decide";
  if (d.options) return `${d.options} options`;
  if (d.looks) return `${d.looks} looks`;
  return null;
}

/** Deterministic preference_anchor chip from persona truth. */
function truthAnchorChip(persona: Persona): string | null {
  const a = persona.truth.anchor;
  if (a === "n/a") return null;
  if (a === "keep") return "The usual";
  if (a === "push") return "Push me a little";
  if (a === "explore") return "Something new";
  return null;
}

/**
 * Deterministic slots checklist reply: tick truth − owns; free-text any
 * wanted piece missing from chips.
 */
export function buildSlotsChecklistReply(
  persona: Persona,
  question: FashionClarificationQuestion,
): string {
  const labels = optionLabels(question.quick_options).filter(
    (l) => !/^(other|add a piece)$/i.test(l),
  );
  const ticks: string[] = [];
  const missing: string[] = [];
  for (const g of truthWantedGarments(persona)) {
    const match = labels.find((l) => familiesCover(g, l));
    if (match) ticks.push(match);
    else missing.push(g);
  }
  return [...new Set([...ticks, ...missing])].join(", ");
}

/**
 * Harness bug: checklist answer inconsistent with truth — ONLY when every
 * wanted garment was on the checklist and the shopper still ticked wrong.
 * Missing garment + no Add-a-piece = class C product fail (counted, not excluded).
 */
export function detectSlotsChecklistInconsistency(params: {
  persona: Persona;
  reply: string;
  slotsQuestion: FashionClarificationQuestion;
}): ShopperLeak | null {
  const { persona, reply, slotsQuestion } = params;
  const labels = optionLabels(slotsQuestion.quick_options).filter(
    (l) => !/^(other|add a piece)$/i.test(l),
  );
  const answered = parseSlotsClarificationAnswer(reply, labels);
  const owns = persona.truth.owns;
  const wanted = truthWantedGarments(persona);
  if (!wanted.length || !labels.length) return null;

  const allWantedOnList = wanted.every((w) =>
    labels.some((l) => familiesCover(w, l)),
  );
  // Class C: truth garment absent from the list — do not exclude the run.
  if (!allWantedOnList) return null;

  for (const o of owns) {
    const onList = labels.some((l) => familiesCover(o, l));
    if (!onList) continue;
    if (wanted.some((w) => familiesCover(w, o))) continue;
    if (answered.some((a) => familiesCover(a, o))) {
      return {
        fact: "slots_checklist_owns_ticked",
        evidence: reply,
      };
    }
  }

  for (const w of wanted) {
    const hit =
      answered.some((a) => familiesCover(a, w)) ||
      new RegExp(
        `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(reply);
    if (!hit) {
      return {
        fact: "slots_checklist_want_unticked",
        evidence: reply,
      };
    }
  }
  return null;
}

function formatQuestionsForShopper(
  result: Extract<FashionRouterResult, { move: "ask_clarification" }>,
): string {
  const lines: string[] = [result.reply];
  if (result.known_summary) {
    lines.push(`(they remembered: ${result.known_summary})`);
  }
  for (const q of result.questions) {
    const opts = (q.quick_options ?? []).map(optionLabel);
    lines.push(
      `Q[${q.gap}${q.kind ? `/${q.kind}` : ""}]: ${q.text}` +
        (opts.length ? `\nChips: ${opts.join(" | ")}` : ""),
    );
  }
  if (result.ride_along) {
    lines.push(
      `Also: ${result.ride_along.text}\nChips: ${result.ride_along.quick_options.map(optionLabel).join(" | ")}`,
    );
  }
  if (result.escape_chip) lines.push(`Escape chip: ${result.escape_chip}`);
  return lines.join("\n");
}

/** Detect ground-truth leaks not licensed by volunteers / prior asks. */
export function detectShopperLeak(params: {
  persona: Persona;
  reply: string;
  askedGaps: Set<string>;
  discussedGarments: Set<string>;
}): ShopperLeak | null {
  const { persona, reply, askedGaps, discussedGarments } = params;
  const text = reply.toLowerCase();
  const volunteers = persona.volunteers;

  if (volunteers === "everything") return null;

  // Impatience / escape lines are licensed even with a number in them.
  if (
    /\b(just show me|vas-y|يلا|montre-moi|go ahead)\b/i.test(text)
  ) {
    return null;
  }

  const budget = persona.truth.budget;
  if (
    budget &&
    budget !== "no_cap" &&
    !askedGaps.has("budget") &&
    !askedGaps.has("budget_max")
  ) {
    if (
      text.includes(String(budget.max)) ||
      /\$\s*\d+/.test(text) ||
      /\bunder\s+\d+/.test(text)
    ) {
      return { fact: "budget", evidence: reply };
    }
  }

  if (
    persona.truth.depth !== "you_decide" &&
    !askedGaps.has("depth") &&
    volunteers === "little"
  ) {
    const looks = persona.truth.depth.looks;
    const options = persona.truth.depth.options;
    if (
      (looks && new RegExp(`\\b${looks}\\s*looks?\\b`).test(text)) ||
      (options && new RegExp(`\\b${options}\\s*options?\\b`).test(text))
    ) {
      return { fact: "depth", evidence: reply };
    }
  }

  // Also strip unprompted depth from "some" volunteers when not asked
  // (handled in scrub); detect for little only above.

  if (!askedGaps.has("size") && volunteers === "little") {
    for (const size of Object.values(persona.profile.sizes ?? {})) {
      if (!size) continue;
      const s = size.toLowerCase();
      // Single-letter sizes (S/M/L) match contractions like "it's" — require
      // size context before flagging.
      const hit =
        /^[xsml]{1,3}$/i.test(s)
          ? new RegExp(
              `\\b(?:size|wear)\\W{0,4}${s}\\b|\\b(?:tops?|bottoms?|shoes?)\\s+${s}\\b`,
              "i",
            ).test(text)
          : new RegExp(`\\b${s}\\b`, "i").test(text);
      if (hit) return { fact: `size:${size}`, evidence: reply };
    }
  }

  for (const g of persona.truth.garments) {
    const gLower = g.toLowerCase();
    if (discussedGarments.has(gLower)) continue;
    if (volunteers !== "little") continue;
    if (askedGaps.has("slots") || askedGaps.has("garment")) continue;
    if (persona.opening_message.toLowerCase().includes(gLower)) continue;
    if (new RegExp(`\\b${gLower}\\b`, "i").test(text)) {
      return { fact: `garment:${g}`, evidence: reply };
    }
  }

  return null;
}

export async function generateShopperReply(params: {
  persona: Persona;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  routerAsk: Extract<FashionRouterResult, { move: "ask_clarification" }> | null;
  resultsArrived?: boolean;
  questionRound: number;
  impatient: boolean;
  traceId: string;
}): Promise<string> {
  const { persona, history, routerAsk, resultsArrived, impatient, traceId } =
    params;

  const slotsQ = routerAsk?.questions.find((q) => q.gap === "slots");
  const slotsTick = slotsQ
    ? buildSlotsChecklistReply(persona, slotsQ)
    : null;
  const garmentQ = routerAsk?.questions.find((q) => q.gap === "garment");
  const garmentTick = garmentQ
    ? truthWantedGarments(persona).join(", ")
    : null;
  const anchorQ = routerAsk?.questions.find(
    (q) => q.gap === "preference_anchor",
  );
  const anchorTick = anchorQ ? truthAnchorChip(persona) : null;

  const depthQ = routerAsk?.questions.find((q) => q.gap === "depth");
  const depthTick = depthQ ? truthDepthChip(persona) : null;

  /** UI Done format: "gap: label | gap: label" — never space-joined. */
  const doneParts: string[] = [];
  if (slotsQ && slotsTick) {
    doneParts.push(formatPullSheetPart("slots", slotsTick));
  }
  if (garmentQ && garmentTick) {
    doneParts.push(formatPullSheetPart("garment", garmentTick));
  }
  if (anchorQ && anchorTick) {
    doneParts.push(formatPullSheetPart("preference_anchor", anchorTick));
  }
  if (depthQ && depthTick) {
    doneParts.push(formatPullSheetPart("depth", depthTick));
  }
  const donePrefix = doneParts.join(PULL_SHEET_JOIN);

  if (impatient && !resultsArrived) {
    if (donePrefix) {
      if (persona.language === "fr") return `${donePrefix} | escape: vas-y, montre-moi`;
      if (persona.language === "ar") return `${donePrefix} | escape: يلا ورّيني`;
      return `${donePrefix} | escape: just show me what you've got`;
    }
    if (persona.language === "fr") return "vas-y, montre-moi juste";
    if (persona.language === "ar") return "يلا ورّيني";
    return "just show me what you've got";
  }

  // Deterministic garment / slots / anchor — never trust the LLM to invent.
  if (donePrefix) {
    const otherQs = (routerAsk?.questions ?? []).filter(
      (q) =>
        q.gap !== "slots" &&
        q.gap !== "garment" &&
        q.gap !== "preference_anchor" &&
        q.gap !== "depth",
    );
    if (!otherQs.length && !routerAsk?.ride_along) {
      return donePrefix;
    }
    const partialAsk = routerAsk
      ? { ...routerAsk, questions: otherQs }
      : null;
    const rest = await generateShopperReplyLlm({
      persona,
      history,
      routerAsk:
        otherQs.length || routerAsk?.ride_along ? partialAsk : null,
      resultsArrived,
      traceId,
    });
    // LLM rest may itself be gap-prefixed; keep pipe join, never ". ".
    const restTrim = rest.trim();
    if (!restTrim) return donePrefix;
    if (/^[a-z_]+\s*:/i.test(restTrim) || restTrim.includes(PULL_SHEET_JOIN)) {
      return `${donePrefix}${PULL_SHEET_JOIN}${restTrim}`;
    }
    // Single remaining answer — attach to first other gap if any.
    const restGap = otherQs[0]?.gap ?? "answer";
    return `${donePrefix}${PULL_SHEET_JOIN}${formatPullSheetPart(restGap, restTrim)}`;
  }

  return generateShopperReplyLlm({
    persona,
    history,
    routerAsk,
    resultsArrived,
    traceId,
  });
}

async function generateShopperReplyLlm(params: {
  persona: Persona;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  routerAsk: Extract<FashionRouterResult, { move: "ask_clarification" }> | null;
  resultsArrived?: boolean;
  traceId: string;
}): Promise<string> {
  const { persona, history, routerAsk, resultsArrived, traceId } = params;

  const userPayload = resultsArrived
    ? "Results just arrived (looks on a rack). React in one short line."
    : routerAsk
      ? `The stylist asked:\n${formatQuestionsForShopper(routerAsk)}`
      : "The stylist replied without questions. Send a short follow-up as yourself.";

  const msg = await tracedLLMCall({
    traceId,
    stage: "eval_shopper",
    model: EVAL_SHOPPER_MODEL,
    systemPrompt: buildShopperSystemPrompt(persona),
    disablePromptCache: true,
    maxTokens: 220,
    inputMessages: [
      ...history.map((m) => ({
        role: m.role === "assistant" ? ("user" as const) : ("assistant" as const),
        content:
          m.role === "assistant"
            ? `Stylist: ${m.content}`
            : `You previously said: ${m.content}`,
      })),
      {
        role: "user",
        content: [
          "Transcript so far:",
          ...history.map((m) => `${m.role}: ${m.content}`),
          "",
          userPayload,
        ].join("\n"),
      },
    ],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();
  let reply = text.replace(/^["']|["']$/g, "").trim() || "ok";

  // Deterministic leak scrub for "little"/"some" — model may still volunteer.
  if (
    (persona.volunteers === "little" || persona.volunteers === "some") &&
    routerAsk
  ) {
    const gaps = new Set(gapsFromQuestions(routerAsk.questions));
    reply = scrubShopperLeak({
      persona,
      reply,
      askedGaps: gaps,
    });
  }
  return reply;
}

/** Strip unsolicited size/budget/garment/depth tokens from a shopper reply. */
export function scrubShopperLeak(params: {
  persona: Persona;
  reply: string;
  askedGaps: Set<string>;
}): string {
  let reply = params.reply;
  const { persona, askedGaps } = params;
  if (persona.volunteers === "everything") return reply;

  if (!askedGaps.has("depth")) {
    reply = reply.replace(/\b\d+\s*looks?\b/gi, "");
    reply = reply.replace(/\b\d+\s*options?\b/gi, "");
  }
  if (!askedGaps.has("size") && !askedGaps.has("budget")) {
    reply = reply.replace(
      /\b(?:I'm usually|I wear|size)\s+(?:an?\s+)?(?:XXS|XS|S|M|L|XL|XXL|\d{1,2})(?:\s+in\s+\w+)?/gi,
      "",
    );
    reply = reply.replace(
      /\b(?:tops?|bottoms?|shoes?)\s+(?:size\s+)?(?:XXS|XS|S|M|L|XL|\d{1,2})\b/gi,
      "",
    );
  }
  if (!askedGaps.has("budget") && persona.truth.budget && persona.truth.budget !== "no_cap") {
    const max = String(persona.truth.budget.max);
    reply = reply.replace(new RegExp(`\\$?\\s*${max}\\b`, "g"), "");
    reply = reply.replace(/\bunder\s+\$?\d+\b/gi, "");
  }
  if (
    persona.volunteers === "little" &&
    !askedGaps.has("slots") &&
    !askedGaps.has("garment")
  ) {
    for (const g of persona.truth.garments) {
      if (persona.opening_message.toLowerCase().includes(g.toLowerCase())) continue;
      reply = reply.replace(new RegExp(`\\b${g}\\b`, "gi"), "");
    }
  }
  return reply.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim() || "ok";
}

export function gapsFromQuestions(
  questions: FashionClarificationQuestion[],
): string[] {
  return questions.map((q) => q.gap);
}
