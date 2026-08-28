import type {
  FashionClarificationQuestion,
  FashionRouterResult,
  FashionSearchBrief,
} from "@/lib/fashion-memory/router/types";
import { sizeFamiliesNamedInText } from "@/lib/fashion-memory/intake/usable-stated-size";
import {
  isBannedStylistLine,
  knownSummaryPassesTemplate,
  replyUsesClientWords,
} from "@/lib/fashion-memory/router/voice-hygiene";
import { consultQuestionsThatSpendBudget } from "@/lib/fashion-memory/router/consultation";
import { garmentCoveredByBrief } from "./garment-family";
import type { Persona } from "./persona";
import { patienceRounds } from "./persona";
import type { PersonaRunResult, TranscriptTurn } from "./run-persona";

export type CheckResult = {
  id: string;
  pass: boolean;
  reason: string;
};

function asks(transcript: TranscriptTurn[]): Array<{
  turn: TranscriptTurn;
  questions: FashionClarificationQuestion[];
  known_summary?: string;
  reply: string;
}> {
  const out: Array<{
    turn: TranscriptTurn;
    questions: FashionClarificationQuestion[];
    known_summary?: string;
    reply: string;
  }> = [];
  for (const t of transcript) {
    if (t.router?.move === "ask_clarification") {
      out.push({
        turn: t,
        questions: t.router.questions,
        known_summary: t.router.known_summary,
        reply: t.router.reply,
      });
    }
  }
  return out;
}

function userTexts(transcript: TranscriptTurn[]): string[] {
  return transcript.filter((t) => t.role === "user").map((t) => t.content);
}

function profileFactTexts(persona: Persona): string[] {
  const facts: string[] = [];
  for (const [k, v] of Object.entries(persona.profile.sizes ?? {})) {
    facts.push(`${k}:${v}`.toLowerCase());
    facts.push(v.toLowerCase());
  }
  for (const s of persona.profile.signals ?? []) {
    facts.push(s.toLowerCase());
  }
  return facts;
}

function isDressCodeOccasion(occasion: string): boolean {
  return /baptism|wedding|interview|funeral|church|gala|black.?tie|formal/i.test(
    occasion,
  );
}

function needsAnchor(state: Persona["profile"]["state"]): boolean {
  return (
    state === "known_relevant" ||
    state === "quick_shopper" ||
    state === "has_pick_history"
  );
}

function sizeAnsweredInReply(
  reply: string,
  q: FashionClarificationQuestion,
): boolean {
  const t = reply.trim();
  if (!t) return false;
  const family = (q.garment_type ?? "").toLowerCase();
  const lower = t.toLowerCase();
  // Explicit family mention
  if (family && lower.includes(family)) return true;
  if (/\btops?\b/.test(lower) && (family === "tops" || !family)) return true;
  if (/\bbottoms?\b/.test(lower) && family === "bottoms") return true;
  if (/\bshoes?\b/.test(lower) && family === "shoes") return true;
  // Echoed question + answer
  if (q.text && lower.includes(q.text.toLowerCase().slice(0, 24))) return true;
  // Bare token: only counts for the first alpha-size family (tops) when
  // multiple size rows were asked — bottoms/shoes need a number or label.
  const bare = /^(XXS|XS|S|M|L|XL|XXL|XXXL)$/i.test(t);
  const bareNum = /^\d{1,2}(\.\d)?$/.test(t);
  if (bare) return family === "tops" || family === "dresses" || !family;
  if (bareNum) {
    const n = Number(t);
    if (family === "shoes") return (n >= 5 && n <= 15) || (n >= 35 && n <= 50);
    if (family === "bottoms") return n >= 24 && n <= 44;
    return false;
  }
  // Multi-part reply mentioning size chips
  const opts = (q.quick_options ?? []).map((o) =>
    typeof o === "string" ? o : o.label,
  );
  return opts.some((o) => o && new RegExp(`\\b${o}\\b`, "i").test(t));
}

/** Consultative questions excluding preference_anchor (recognition, not a consult). */
export function consultQuestionCount(transcript: TranscriptTurn[]): number {
  let n = 0;
  for (const t of transcript) {
    if (t.router?.move !== "ask_clarification") continue;
    n += consultQuestionsThatSpendBudget(t.router.questions).length;
  }
  return n;
}

export function userFacingAssistantText(transcript: TranscriptTurn[]): string {
  const parts: string[] = [];
  for (const t of transcript) {
    if (t.role !== "assistant") continue;
    parts.push(t.content);
    const r = t.router;
    if (!r) continue;
    if ("known_summary" in r && r.known_summary) parts.push(r.known_summary);
    if ("reply" in r && r.reply) parts.push(r.reply);
    if ("pull_line" in r && r.pull_line) parts.push(r.pull_line);
    if (r.move === "ask_clarification") {
      for (const q of r.questions) parts.push(q.text);
    }
  }
  return parts.join("\n");
}

export async function runDeterministicChecks(
  result: PersonaRunResult,
): Promise<CheckResult[]> {
  const { persona, transcript, brief, impatient, question_rounds } = result;
  const askTurns = asks(transcript);
  const checks: CheckResult[] = [];

  // no_reask — only mark a size family answered when the reply actually
  // addressed that family (partial "L" does not satisfy bottoms/shoes).
  {
    const priorUser = userTexts(transcript);
    const profileFacts = profileFactTexts(persona);
    let fail: string | null = null;
    for (let i = 0; i < askTurns.length; i++) {
      const prior = priorUser.slice(0, i + 1).join(" ").toLowerCase();
      for (const q of askTurns[i]!.questions) {
        if (q.gap !== "size") continue;
        for (const fact of profileFacts) {
          if (
            fact.length >= 2 &&
            prior.includes(fact) &&
            q.text.toLowerCase().includes(fact)
          ) {
            fail = `re-asked size fact ${fact}`;
          }
        }
      }
    }
    const answeredGaps = new Set<string>();
    for (let i = 0; i < askTurns.length; i++) {
      const askIdx = transcript.indexOf(askTurns[i]!.turn);
      const nextUser = transcript.find(
        (t, idx) => idx > askIdx && t.role === "user",
      );
      for (const q of askTurns[i]!.questions) {
        const key = `${q.gap}:${q.garment_type ?? ""}`;
        if (answeredGaps.has(key)) {
          fail = `re-asked ${q.gap}${q.garment_type ? `:${q.garment_type}` : ""} after prior answer`;
        }
      }
      if (nextUser) {
        for (const q of askTurns[i]!.questions) {
          if (q.gap === "size") {
            if (sizeAnsweredInReply(nextUser.content, q)) {
              answeredGaps.add(`${q.gap}:${q.garment_type ?? ""}`);
            }
          } else {
            answeredGaps.add(`${q.gap}:${q.garment_type ?? ""}`);
          }
        }
      }
    }
    checks.push({
      id: "no_reask",
      pass: !fail,
      reason: fail ?? "no re-asks detected",
    });
  }

  // sizes_one_turn — at most 2 size turns (initial + one remaining-families follow-up)
  {
    const sizeTurns = askTurns.filter((a) =>
      a.questions.some((q) => q.gap === "size"),
    );
    const pass =
      sizeTurns.length <= 2 ||
      persona.profile.state !== "new" ||
      Boolean(persona.profile.sizes);
    checks.push({
      id: "sizes_one_turn",
      pass,
      reason: pass
        ? "size families on ≤2 turns (or known)"
        : `size asked across ${sizeTurns.length} turns`,
    });
  }

  // blocking_before_consult_ok
  {
    let consult = 0;
    let fail: string | null = null;
    for (const a of askTurns) {
      const hasBlocking = a.questions.some((q) => q.kind === "blocking");
      const hasConsult = a.questions.some(
        (q) =>
          q.kind === "consult" ||
          (!q.kind &&
            q.gap !== "size" &&
            q.gap !== "department" &&
            q.gap !== "person_name"),
      );
      if (hasConsult && !hasBlocking) consult += 1;
      if (hasBlocking && hasConsult) {
        // mixed ok; blocking shouldn't burn — we only count pure consult turns
      }
    }
    const briefConsult = brief?.consultation?.rounds_used ?? consult;
    if (briefConsult > 2) fail = `consult rounds ${briefConsult} > 2`;
    checks.push({
      id: "blocking_before_consult_ok",
      pass: !fail,
      reason: fail ?? `consult rounds ok (${briefConsult})`,
    });
  }

  // rounds_vs_patience
  {
    const limit = patienceRounds(persona.patience);
    const edgeForced =
      persona.edge === "speed_signal_turn2" || persona.edge === "dodges_size";
    const pass = !impatient || question_rounds > limit || edgeForced;
    checks.push({
      id: "rounds_vs_patience",
      pass,
      reason: pass
        ? "impatience only after patience or edge"
        : `impatient after ${question_rounds} rounds (limit ${limit})`,
    });
  }

  // pull_sheet_present
  {
    const needsSheet =
      (persona.truth.request_type === "outfit" ||
        persona.truth.request_type === "capsule") &&
      persona.volunteers !== "everything";
    const hasSheet = askTurns.some(
      (a) =>
        a.questions.some((q) => q.gap === "slots") &&
        a.questions.some((q) => q.gap === "depth"),
    );
    const readyWithDepth =
      brief?.depth?.source === "stated" || brief?.depth?.source === "you_decide";
    const pass = !needsSheet || hasSheet || Boolean(readyWithDepth);
    checks.push({
      id: "pull_sheet_present",
      pass,
      reason: pass
        ? "pull sheet or stated depth present"
        : "missing slots+depth pull sheet",
    });
  }

  // pull_sheet_split — slots after depth/anchor already asked = fail
  {
    let depthOrAnchorAsked = false;
    let fail: string | null = null;
    for (const a of askTurns) {
      const gaps = new Set(a.questions.map((q) => q.gap));
      if (gaps.has("slots") && depthOrAnchorAsked && !gaps.has("depth")) {
        fail = "slots asked after depth/anchor without bundling";
        break;
      }
      if (gaps.has("depth") || gaps.has("preference_anchor")) {
        depthOrAnchorAsked = true;
      }
    }
    checks.push({
      id: "pull_sheet_split",
      pass: !fail,
      reason: fail ?? "pull sheet not split",
    });
  }

  // anchor_asked
  {
    const should = needsAnchor(persona.profile.state);
    const asked = askTurns.some((a) =>
      a.questions.some((q) => q.gap === "preference_anchor"),
    );
    const usualPre =
      should &&
      askTurns.some((a) =>
        a.questions.some(
          (q) =>
            q.gap === "preference_anchor" &&
            (q.quick_options ?? []).some((o) => {
              const label = typeof o === "string" ? o : o.label;
              const pre =
                typeof o === "string" ? false : Boolean(o.preselected);
              return /usual/i.test(label) && (pre || true);
            }),
        ),
      );
    let pass = should ? asked : !asked;
    let reason = should
      ? asked
        ? "anchor asked for known-relevant class"
        : "missing preference_anchor"
      : asked
        ? "anchor asked for new/irrelevant (should not)"
        : "anchor correctly skipped";
    if (should && asked && !usualPre) {
      // soft: still pass if asked; prefer usual present
      reason = "anchor asked (usual chip presence soft)";
    }
    checks.push({ id: "anchor_asked", pass, reason });
  }

  // color_on_dress_code
  {
    const need =
      persona.profile.state === "new" &&
      persona.truth.request_type === "outfit" &&
      isDressCodeOccasion(persona.truth.occasion);
    const asked = askTurns.some((a) =>
      a.questions.some((q) => q.gap === "color"),
    );
    const pass = !need || asked;
    checks.push({
      id: "color_on_dress_code",
      pass,
      reason: pass
        ? "color rule satisfied"
        : "new+outfit+dress-code missing color ask",
    });
  }

  // truth_match — family-normalized garments (Haiku for unknowns)
  {
    if (!brief) {
      checks.push({
        id: "truth_match",
        pass: false,
        reason: "no ready_to_search brief",
      });
    } else {
      const expected = persona.truth.garments.filter(
        (g) =>
          !persona.truth.owns
            .map((o) => o.toLowerCase())
            .includes(g.toLowerCase()),
      );
      const missing: string[] = [];
      for (const g of expected) {
        const covered = await garmentCoveredByBrief({
          expected: g,
          got: brief.garments,
          traceId: result.traceId,
          allowHaiku: process.env.EVAL_TRUTH_MATCH_NO_HAIKU !== "1",
        });
        if (!covered) missing.push(g);
      }
      let fail: string | null = missing.length
        ? `missing garments ${missing.join(",")}`
        : null;
      if (
        persona.truth.anchor !== "n/a" &&
        brief.preference_anchor &&
        brief.preference_anchor !== "unspecified" &&
        brief.preference_anchor !== persona.truth.anchor
      ) {
        fail = `anchor ${brief.preference_anchor} != ${persona.truth.anchor}`;
      }
      if (
        persona.truth.depth !== "you_decide" &&
        persona.truth.depth.looks &&
        brief.depth?.source !== "you_decide" &&
        brief.depth?.looks_wanted &&
        brief.depth.looks_wanted !== persona.truth.depth.looks
      ) {
        fail = `depth looks ${brief.depth.looks_wanted} != ${persona.truth.depth.looks}`;
      }
      if (
        persona.truth.depth !== "you_decide" &&
        persona.truth.depth.options &&
        brief.depth?.source !== "you_decide" &&
        brief.depth?.options_per_item !== persona.truth.depth.options
      ) {
        fail = `depth options ${brief.depth?.options_per_item ?? "missing"} != ${persona.truth.depth.options}`;
      }
      checks.push({
        id: "truth_match",
        pass: !fail,
        reason: fail ?? "brief matches truth",
      });
    }
  }

  // pick_history_leak — recent_picks must not leak into garments/brands
  {
    const picks = persona.profile.recent_picks ?? [];
    if (!brief || !picks.length) {
      checks.push({
        id: "pick_history_leak",
        pass: true,
        reason: !brief ? "n/a no brief" : "no recent_picks",
      });
    } else {
      const opening = persona.opening_message.toLowerCase();
      const truthG = new Set(
        [...persona.truth.garments, ...persona.truth.owns].map((g) =>
          g.toLowerCase(),
        ),
      );
      const leaks: string[] = [];
      for (const g of brief.garments ?? []) {
        const gl = g.toLowerCase().trim();
        if (!gl || gl.length > 40) continue;
        if (truthG.has(gl) || opening.includes(gl)) continue;
        if (
          [...truthG].some(
            (t) => t.includes(gl) || gl.includes(t),
          )
        ) {
          continue;
        }
        const onlyInPicks = picks.some((p) => {
          const pl = p.toLowerCase();
          return pl.includes(gl) || gl.includes(pl.split(/\s+/).pop() ?? "");
        });
        const inTranscript = result.transcript.some(
          (t) =>
            t.role === "user" && t.content.toLowerCase().includes(gl),
        );
        if (onlyInPicks && !inTranscript) {
          leaks.push(`garment:${g}`);
        }
      }
      const brands =
        brief.brand_direction?.source === "stated"
          ? (brief.brand_direction.brands ?? [])
          : [];
      for (const b of brands) {
        const bl = b.toLowerCase();
        if (opening.includes(bl)) continue;
        if (picks.some((p) => p.toLowerCase().includes(bl))) {
          leaks.push(`brand:${b}`);
        }
      }
      for (const m of brief.must_haves ?? []) {
        const ml = m.toLowerCase();
        if (opening.includes(ml) || [...truthG].some((t) => ml.includes(t))) {
          continue;
        }
        if (picks.some((p) => p.toLowerCase().includes(ml) || ml.includes(p.toLowerCase()))) {
          leaks.push(`must_have:${m}`);
        }
      }
      checks.push({
        id: "pick_history_leak",
        pass: leaks.length === 0,
        reason: leaks.length ? `leaked ${leaks.join(",")}` : "clean",
      });
    }
  }

  // depth_honored / header_recap_agree / no_silent_drop — router stage N/A or brief-only
  {
    const routerOnly = result.stage === "router";
    checks.push({
      id: "depth_honored",
      pass: true,
      reason: routerOnly ? "n/a router stage" : "checked in full stage",
    });
    checks.push({
      id: "header_recap_agree",
      pass: true,
      reason: routerOnly ? "n/a router stage" : "checked in full stage",
    });
  }

  // no_silent_drop
  {
    if (!brief) {
      checks.push({
        id: "no_silent_drop",
        pass: false,
        reason: "no brief",
      });
    } else {
      checks.push({
        id: "no_silent_drop",
        pass: brief.garments.length > 0,
        reason:
          brief.garments.length > 0
            ? "brief has garments"
            : "empty brief garments",
      });
    }
  }

  // assumptions_are_speech
  {
    const banned =
      /\b(depth\.source|brief\.|pipeline|specified as|defaulted|knowledge_state)\b/i;
    let fail: string | null = null;
    for (const t of transcript) {
      const assumptions =
        t.router && "brief" in t.router
          ? t.router.brief?.assumptions
          : undefined;
      const list = assumptions ?? [];
      for (const line of list) {
        if (banned.test(line)) {
          fail = `assumption log-speak: ${line.slice(0, 80)}`;
        }
      }
    }
    if (brief?.assumptions) {
      for (const line of brief.assumptions) {
        if (banned.test(line)) fail = `assumption log-speak: ${line.slice(0, 80)}`;
      }
    }
    checks.push({
      id: "assumptions_are_speech",
      pass: !fail,
      reason: fail ?? "assumptions sound like speech",
    });
  }

  // known_summary_present
  {
    const knownClient = persona.profile.state !== "new";
    const fail =
      knownClient &&
      askTurns.some((a) => !a.known_summary?.trim())
        ? "ask turn missing known_summary"
        : null;
    checks.push({
      id: "known_summary_present",
      pass: !fail,
      reason: fail ?? "known_summary ok",
    });
  }

  // known_summary_template — ≥1 concrete fact or omitted; no bare log dump
  {
    let fail: string | null = null;
    for (const a of askTurns) {
      const ks = a.known_summary?.trim();
      if (!ks) continue;
      if (!knownSummaryPassesTemplate(ks)) {
        fail = "known_summary lacks concrete fact";
        break;
      }
    }
    checks.push({
      id: "known_summary_template",
      pass: !fail,
      reason: fail ?? "known_summary template ok",
    });
  }

  // pick_referenced — when recent_picks exist and anchor is asked, quote a pick
  {
    const picks = persona.profile.recent_picks ?? [];
    let fail: string | null = null;
    if (picks.length) {
      const anchorAsk = askTurns.find((a) =>
        a.questions.some((q) => q.gap === "preference_anchor"),
      );
      if (anchorAsk) {
        const qText = anchorAsk.questions
          .filter((q) => q.gap === "preference_anchor")
          .map((q) => q.text)
          .join(" ")
          .toLowerCase();
        const refsPick = picks.some((p) => {
          const token = p.toLowerCase().split(/\s+/).pop() ?? "";
          return token.length >= 4 && qText.includes(token);
        });
        if (!refsPick) fail = "anchor question missing recent_pick reference";
      }
    }
    checks.push({
      id: "pick_referenced",
      pass: !fail,
      reason: fail ?? (picks.length ? "pick referenced" : "n/a no picks"),
    });
  }

  // reply_uses_client_words — ready reply (and non-banned ask) uses client nouns
  {
    let fail: string | null = null;
    for (let i = 0; i < transcript.length; i++) {
      const t = transcript[i]!;
      if (t.role !== "assistant" || !t.router) continue;
      let lastU = "";
      for (let j = i - 1; j >= 0; j--) {
        if (transcript[j]!.role === "user") {
          lastU = transcript[j]!.content;
          break;
        }
      }
      const content = t.content.replace(/\nSearching the stores.*/s, "").trim();
      if (!content) continue;
      if (isBannedStylistLine(content)) {
        fail = "banned scripted stylist line";
        break;
      }
      if (t.router.move !== "ready_to_search") continue;
      if (/^searching the stores$/i.test(content)) continue;
      if (!replyUsesClientWords({ reply: content, lastUser: lastU })) {
        fail = "ready reply missing client occasion/garment words";
        break;
      }
    }
    checks.push({
      id: "reply_uses_client_words",
      pass: !fail,
      reason: fail ?? "reply uses client words",
    });
  }

  // line_reuse — any assistant line ≥2× in a transcript fails (gate uses run-wide ≥2)
  {
    const counts = new Map<string, number>();
    for (const t of transcript) {
      if (t.role !== "assistant") continue;
      const line = t.content
        .replace(/\nSearching the stores.*/s, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!line || line === "searching the stores") continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    const reused = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([line, n]) => `${n}× ${line.slice(0, 72)}`);
    checks.push({
      id: "line_reuse",
      pass: reused.length === 0,
      reason: reused.length ? reused.join(" | ") : "no line reused ≥2×",
    });
  }

  // name_in_self_question — self recipient never uses client name in a question
  {
    const selfName = persona.name?.trim();
    let fail: string | null = null;
    const forOther =
      persona.edge === "mentions_new_person" ||
      /\b(for my|gift for|for his|for her)\b/i.test(persona.opening_message);
    if (selfName && selfName.length >= 2 && !forOther) {
      const nameRe = new RegExp(
        `\\b${selfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      for (const a of askTurns) {
        for (const q of a.questions) {
          if (nameRe.test(q.text)) {
            fail = `self question uses name: ${q.text.slice(0, 80)}`;
            break;
          }
        }
        if (fail) break;
      }
    }
    checks.push({
      id: "name_in_self_question",
      pass: !fail,
      reason: fail ?? "self questions use you/your",
    });
  }

  // brand_stated_in_conversation — stated brands must appear in user turns
  {
    const brands =
      brief?.brand_direction?.source === "stated"
        ? (brief.brand_direction.brands ?? [])
        : [];
    const blob = userTexts(transcript).join("\n").toLowerCase();
    const missing = brands.filter((b) => !blob.includes(b.toLowerCase()));
    checks.push({
      id: "brand_stated_in_conversation",
      pass: missing.length === 0,
      reason: missing.length
        ? `stated brands absent from chat: ${missing.join(",")}`
        : "brand stated ok",
    });
  }

  // stated_sizes_named_families — stated sizes only for families client named
  {
    const sizes = brief?.stated_facts?.sizes ?? {};
    const named = new Set<string>();
    for (const u of userTexts(transcript)) {
      for (const f of sizeFamiliesNamedInText(u)) named.add(f);
    }
    for (const f of sizeFamiliesNamedInText(persona.opening_message)) {
      named.add(f);
    }
    // Size asks count as naming
    for (const a of askTurns) {
      for (const q of a.questions) {
        if (q.gap !== "size") continue;
        const fam = (q.garment_type ?? "").toLowerCase();
        if (fam) named.add(fam);
      }
    }
    const extra: string[] = [];
    for (const [fam, val] of Object.entries(sizes)) {
      if (val == null || val === "") continue;
      if (!named.has(fam)) extra.push(fam);
    }
    checks.push({
      id: "stated_sizes_named_families",
      pass: extra.length === 0,
      reason: extra.length
        ? `stated sizes for unasked families: ${extra.join(",")}`
        : "stated sizes ok",
    });
  }

  // greeting_not_offtopic
  {
    const opening = transcript[0]?.content ?? "";
    const greetingOnly = /^(hi|hey|hello|salut|bonjour|مرحبا|اهلا)\b/i.test(
      opening.trim(),
    );
    const first = transcript.find((t) => t.role === "assistant")?.router;
    const fail =
      greetingOnly && first?.move === "respond_off_topic"
        ? "greeting handled as off_topic"
        : null;
    checks.push({
      id: "greeting_not_offtopic",
      pass: !fail,
      reason: fail ?? "greeting ok",
    });
  }

  // refinement_no_consult
  {
    if (persona.edge !== "refines_after_results") {
      checks.push({
        id: "refinement_no_consult",
        pass: true,
        reason: "n/a",
      });
    } else {
      const readyIdx = transcript.findIndex(
        (t) => t.router?.move === "ready_to_search",
      );
      const after = transcript.slice(readyIdx + 1);
      const refineAsk = after.find((t) => t.router?.move === "ask_clarification");
      const pass =
        !refineAsk ||
        (refineAsk.router?.move === "ask_clarification" &&
          refineAsk.router.questions.length === 0);
      checks.push({
        id: "refinement_no_consult",
        pass: Boolean(pass),
        reason: pass
          ? "refinement had no questions"
          : "refinement asked consult questions",
      });
    }
  }

  // refinement_reuse — next-step chip must not full-requery when garments hold
  {
    if (persona.edge !== "refines_after_results") {
      checks.push({
        id: "refinement_reuse",
        pass: true,
        reason: "n/a",
      });
    } else if (result.stage !== "full") {
      checks.push({
        id: "refinement_reuse",
        pass: true,
        reason: "n/a (router stage)",
      });
    } else if (!result.refinement_garments_unchanged) {
      checks.push({
        id: "refinement_reuse",
        pass: true,
        reason: `n/a (garments changed; mode=${result.refinement_mode ?? "none"})`,
      });
    } else {
      const mode = result.refinement_mode;
      const pass = mode != null && mode !== "full";
      checks.push({
        id: "refinement_reuse",
        pass,
        reason: pass
          ? `refinement_mode=${mode}`
          : `garments unchanged but refinement_mode=${mode ?? "missing"}`,
      });
    }
  }

  // language_mirrored — kept in code, disabled from exit criteria while
  // English-only seeds run. Re-enable when `--languages fr,ar` returns.
  {
    const LANGUAGE_MIRROR_CHECK_ENABLED = false;
    if (LANGUAGE_MIRROR_CHECK_ENABLED) {
      const assistantReplies = transcript
        .filter((t) => t.role === "assistant")
        .map((t) => t.content);
      let pass = true;
      let reason = "language mirrored";
      if (persona.language === "ar") {
        const hasArabic = assistantReplies.some((r) =>
          /[\u0600-\u06FF]/.test(r),
        );
        if (/[\u0600-\u06FF]/.test(persona.opening_message) && !hasArabic) {
          pass = false;
          reason = "Arabic opening but assistant never used Arabic";
        }
      }
      if (persona.language === "fr") {
        const hasFr = assistantReplies.some((r) =>
          /\b(je|vous|pour|avec|une|des)\b/i.test(r),
        );
        if (
          /\b(je|j'|salut|bonjour|besoin)\b/i.test(persona.opening_message) &&
          !hasFr &&
          assistantReplies.length
        ) {
          pass = false;
          reason = "French opening but assistant lacked French cues";
        }
      }
      checks.push({ id: "language_mirrored", pass, reason });
    } else {
      checks.push({
        id: "language_mirrored",
        pass: true,
        reason: "disabled (English-only seed)",
      });
    }
  }

  return checks;
}
