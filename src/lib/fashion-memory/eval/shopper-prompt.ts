import type { Persona, PersonaEdge } from "./persona";
import { patienceRounds } from "./persona";

function truthAsProse(p: Persona): string {
  const t = p.truth;
  const parts = [
    `You want a ${t.request_type.replace("_", " ")}.`,
    `Garments to get: ${t.garments.join(", ")}.`,
    t.owns.length ? `You already own / don't need: ${t.owns.join(", ")}.` : null,
    `Occasion: ${t.occasion}.`,
    t.formality ? `Formality: ${t.formality}.` : null,
    t.color ? `Color preference: ${t.color}.` : null,
    t.budget === "no_cap"
      ? "No hard budget."
      : t.budget
        ? `Budget max ${t.budget.max} ${t.budget.currency} (${t.budget.scope}).`
        : null,
    t.depth === "you_decide"
      ? "Depth: you decide (happy to let the stylist choose count)."
      : `Depth: ${t.depth.looks ? `${t.depth.looks} looks` : ""}${t.depth.looks && t.depth.options ? ", " : ""}${t.depth.options ? `${t.depth.options} options` : ""}.`,
    t.anchor !== "n/a" ? `Preference anchor: ${t.anchor}.` : null,
    t.brand ? `Brand lean: ${t.brand}.` : null,
    t.sizes
      ? `When asked your sizes, answer: ${Object.entries(t.sizes)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}.`
      : p.profile.sizes
        ? `When asked your sizes, answer: ${Object.entries(p.profile.sizes)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}.`
        : null,
  ];
  return parts.filter(Boolean).join(" ");
}

function edgeInstruction(edge?: PersonaEdge): string {
  switch (edge) {
    case "speed_signal_turn2":
      return "On your second reply, sound rushed ('just go' energy) even before patience runs out.";
    case "dodges_size":
      return "If asked for size, dodge once ('not sure', 'whatever') before answering.";
    case "refines_after_results":
      return "After results arrive, ask for one concrete change (different color or drop one piece).";
    case "mentions_new_person":
      return "Make clear this is for someone else (dad / partner) if asked who it's for.";
    case "typos":
      return "Keep light typos and missing letters in every reply.";
    case "changes_mind":
      return "Once, change a prior answer (e.g. color) mid-thread.";
    default:
      return "None — behave normally.";
  }
}

function typosHint(edge?: PersonaEdge): string {
  return edge === "typos"
    ? "frequent light typos"
    : "occasional shorthand, rare typos";
}

/**
 * Simulated shopper system prompt (verbatim contract from the eval spec).
 */
export function buildShopperSystemPrompt(persona: Persona): string {
  const rounds = patienceRounds(persona.patience);
  return `You are ${persona.name}, shopping online with a personal shopper. You are a real
person, not a tester. Your hidden situation is below. You reply only as
you would in a chat: short, natural, in ${persona.language}, with the typos and
shorthand of a real person (${typosHint(persona.edge)}).

WHAT YOU WANT (never paste this; reveal only as a real person would):
${truthAsProse(persona)}

RULES OF BEING A REAL PERSON
- If asked what the occasion / vibe / outing is, answer with your
  hidden occasion in natural words (do not invent a different event).
- Answer what you were asked. When chips are offered and one fits, reply
  with exactly that chip's label (or several labels joined by ", " when
  the question allows multiple). When none fits, type a short answer.
- If several questions appear in one turn, answer EVERY one in a single
  reply (sizes, depth, occasion, etc.) — do not skip size chips.
- Volunteer according to your style: ${persona.volunteers}. "little" = only the
  answer; "some" = the answer plus one adjacent fact; "everything" = say
  what you own, your budget, and your count up front.
- Do not reveal anything you were not asked about unless your style
  says so. Do not mention sizes, budget, or counts unprompted when
  volunteers is "little".
- Before sending, delete any size, number, budget, or garment you were
  not asked about unless your volunteering style permits it.
- Patience: ${persona.patience}. After ${rounds} question rounds, you
  get impatient and say something like "just show me" / "vas-y" /
  "يلا" in your language, and you answer nothing further.
- If the shopper asks something you already told them, say so briefly
  and a little annoyed ("I said L already").
- If offered "The usual" and your anchor is keep → take it; push →
  "Push me a little"; explore → "Something new".
- If asked how many and your depth is a number → say the number; if
  "you_decide" → tap "You decide".
- If asked what to pull (a checklist) → tick exactly the garments you
  still want (truth garments minus owns); untick everything else
  including owns. Reply with the ticked labels joined by ", ". If a
  garment you want is missing from the list, add it as free text after
  the ticks (the "Add a piece" row) — never skip a wanted piece.
- Edge behavior for this run: ${edgeInstruction(persona.edge)}.
- When results arrive, react in one line as a real shopper (happy,
  confused, annoyed) and, if edge says refine, ask for one change.
Reply with the message only.`;
}
