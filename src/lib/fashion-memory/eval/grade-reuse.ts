import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashSystemPrompt } from "@/lib/fashion-memory/observability/prompt-hash";
import { ROUTER_PROMPT_STATIC } from "@/lib/fashion-memory/router/prompt";
import { JUDGE_MODEL, type JudgeGrade } from "./judge-prompt";
import type { TranscriptTurn } from "./run-persona";

export const EVAL_ROUTER_PROMPT_HASH = hashSystemPrompt(ROUTER_PROMPT_STATIC);

export type PromptHashes = { router: string };

export function currentPromptHashes(): PromptHashes {
  return { router: EVAL_ROUTER_PROMPT_HASH };
}

/** Byte-stable fingerprint of assistant lines + router tool payloads. */
export function transcriptGradeFingerprint(transcript: TranscriptTurn[]): string {
  const parts: string[] = [];
  for (const t of transcript) {
    if (t.role !== "assistant") continue;
    parts.push(t.content);
    if (t.router) parts.push(JSON.stringify(t.router));
  }
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

export type StoredPersonaArtifact = {
  judge?: JudgeGrade | null;
  judge_opus?: JudgeGrade | null;
  grade_fingerprint?: string;
  prompt_hashes?: PromptHashes;
};

export function canReuseGrade(params: {
  fingerprint: string;
  currentPromptHashes: PromptHashes;
  previous: StoredPersonaArtifact | null;
}): boolean {
  const prev =
    params.previous?.judge_opus ?? params.previous?.judge ?? null;
  if (!prev) return false;
  // Never reuse a Sonnet (or other non-Opus) grade as the headline.
  if (prev.judge_model && prev.judge_model !== JUDGE_MODEL) return false;
  if (params.previous!.grade_fingerprint !== params.fingerprint) return false;
  if (params.previous!.prompt_hashes?.router !== params.currentPromptHashes.router) {
    return false;
  }
  return true;
}

export async function loadPreviousPersonaArtifact(
  previousRunDir: string | null,
  personaId: string,
): Promise<StoredPersonaArtifact | null> {
  if (!previousRunDir) return null;
  try {
    return JSON.parse(
      await readFile(path.join(previousRunDir, `${personaId}.json`), "utf8"),
    ) as StoredPersonaArtifact;
  } catch {
    return null;
  }
}

export function withGradeReuseMeta(
  grade: JudgeGrade,
  reused: boolean,
): JudgeGrade {
  return reused ? { ...grade, grade_reused: true } : grade;
}
