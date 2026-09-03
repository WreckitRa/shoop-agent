import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { AI_CHAT_DEFAULT_MODEL } from "@/lib/ai-chat/constants";
import { generateStylistVerdict, hashedSafetyIdentifier } from "../verdict";
import { assembleVerdictInput } from "../verdict-input";
import { buildReadingView } from "../verdict-reading";
import { runVerdictCardChecks, type VerdictEvalCheck } from "./checks";
import {
  cardTextFromProfile,
  VERDICT_EVAL_PROFILES,
  type VerdictEvalProfile,
} from "./profiles";
import {
  buildSeedPayload,
  EVAL_VERDICT_SEED_SPECS,
  evalVerdictSeedUserId,
  seedEvalVerdictProfiles,
  type EvalVerdictSeedSpec,
} from "./prisma-seed";
import {
  GENERATED_SIMILARITY_MAX,
  maxOffDiagonal,
  pairwiseMatrix,
} from "./similarity";

export type VerdictJudgeGrade = {
  saw_me: number;
  believe_it: number;
  want_the_offer: number;
  why: string;
};

export type VerdictEvalRow = {
  id: string;
  checks: VerdictEvalCheck[];
  passed: boolean;
  grade?: VerdictJudgeGrade | null;
};

export type VerdictEvalResult = {
  rows: VerdictEvalRow[];
  mean?: number;
  passed: boolean;
  similarity?: {
    openings: Record<string, Record<string, number>>;
    rules: Record<string, Record<string, number>>;
    maxOpening: number;
    maxRules: number;
  };
};

function parseGrade(raw: string): VerdictJudgeGrade | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const n = (k: string) => {
      const v = o[k];
      return typeof v === "number" && v >= 1 && v <= 5 ? v : null;
    };
    const saw = n("saw_me");
    const believe = n("believe_it");
    const want = n("want_the_offer");
    if (saw == null || believe == null || want == null) return null;
    return {
      saw_me: saw,
      believe_it: believe,
      want_the_offer: want,
      why: typeof o.why === "string" ? o.why.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}

async function judgeCard(profile: VerdictEvalProfile, text: string) {
  const msg = await createLightweightMessage({
    model: AI_CHAT_DEFAULT_MODEL,
    max_tokens: 300,
    system:
      "You grade onboarding verdict-card copy as a first-time user. Return JSON only.",
    messages: [
      {
        role: "user",
        content: `Profile: ${profile.gender} ${profile.taste} photo=${profile.photo}.\n\nCard text:\n${text}\n\nScore 1–5 on: saw_me (do I understand what he saw in me), believe_it (do I believe it), want_the_offer (do I want the offer). JSON: {"saw_me":n,"believe_it":n,"want_the_offer":n,"why":"≤30 words"}`,
      },
    ],
  });
  const block = msg.content.find((b) => b.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return parseGrade(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
}

function meanOf(grades: number[]): number | undefined {
  if (!grades.length) return undefined;
  return grades.reduce((s, n) => s + n, 0) / grades.length;
}

async function generateOne(spec: EvalVerdictSeedSpec) {
  const userId = evalVerdictSeedUserId(spec.id);
  const payload = buildSeedPayload(spec);
  let photoAnalysis: Record<string, unknown> = {};
  let userReview: Record<string, unknown> = {};
  if (spec.photo) {
    const assembled = await assembleVerdictInput(userId, `eval-${spec.id}`);
    photoAnalysis = (assembled.analysis ?? {}) as Record<string, unknown>;
    userReview = (assembled.review ?? {}) as Record<string, unknown>;
  }
  const { verdict } = await generateStylistVerdict({
    photoAnalysis,
    userReview,
    questionnaireAnswers: payload.questionnaireAnswers,
    measurements: payload.measurements,
    wardrobeInventory: payload.wardrobeInventory,
    applicationContext: payload.applicationContext,
    safetyIdentifier: hashedSafetyIdentifier(userId),
  });
  return verdict;
}

export async function runVerdictEval(opts?: {
  judge?: boolean;
  generate?: boolean;
}): Promise<VerdictEvalResult> {
  if (!opts?.generate) {
    const rows: VerdictEvalRow[] = [];
    const grades: number[] = [];
    for (const profile of VERDICT_EVAL_PROFILES) {
      const { view, text } = cardTextFromProfile(profile);
      const checks = runVerdictCardChecks(view);
      const row: VerdictEvalRow = {
        id: profile.id,
        checks,
        passed: checks.every((c) => c.ok),
      };
      if (opts?.judge) {
        row.grade = await judgeCard(profile, text);
        if (row.grade) {
          grades.push(
            (row.grade.saw_me + row.grade.believe_it + row.grade.want_the_offer) /
              3,
          );
        }
      }
      rows.push(row);
    }
    const mean = meanOf(grades);
    return {
      rows,
      mean,
      passed: rows.every((r) => r.passed) && (mean == null || mean >= 4),
    };
  }

  await seedEvalVerdictProfiles();
  const rows: VerdictEvalRow[] = [];
  const grades: number[] = [];
  const openings: string[] = [];
  const rules: string[] = [];
  const labels: string[] = [];
  for (const spec of EVAL_VERDICT_SEED_SPECS) {
    const verdict = await generateOne(spec);
    const view = buildReadingView({ verdict });
    const checks = runVerdictCardChecks(view);
    const text = [view.headline, view.opening, ...view.rules.map((r) => r.text)]
      .filter(Boolean)
      .join("\n");
    const row: VerdictEvalRow = {
      id: spec.id,
      checks,
      passed: checks.every((c) => c.ok),
    };
    if (opts.judge) {
      row.grade = await judgeCard(
        {
          id: spec.id,
          gender: spec.gender === "masculine" ? "male" : "female",
          taste: spec.taste,
          photo: spec.photo,
          verdict,
        },
        text,
      );
      if (row.grade) {
        grades.push(
          (row.grade.saw_me + row.grade.believe_it + row.grade.want_the_offer) /
            3,
        );
      }
    }
    rows.push(row);
    labels.push(spec.id);
    openings.push(view.opening);
    rules.push(view.rules.map((r) => r.text).join(" | "));
  }
  const openingMatrix = pairwiseMatrix(labels, openings);
  const rulesMatrix = pairwiseMatrix(labels, rules);
  const maxOpening = maxOffDiagonal(openingMatrix);
  const maxRules = maxOffDiagonal(rulesMatrix);
  const mean = meanOf(grades);
  const similarOk =
    maxOpening <= GENERATED_SIMILARITY_MAX &&
    maxRules <= GENERATED_SIMILARITY_MAX;
  return {
    rows,
    mean,
    similarity: {
      openings: openingMatrix,
      rules: rulesMatrix,
      maxOpening,
      maxRules,
    },
    passed:
      rows.every((r) => r.passed) &&
      similarOk &&
      (mean == null || mean >= 4),
  };
}
