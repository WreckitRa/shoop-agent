/**
 * Isolated photo-analysis runner. Results are stored and displayed only.
 * Do not import this from fashion-memory, hard-drops, scoring, or curation.
 */
import {
  photoAnalysisModel,
  photoPreflightModel,
  preflightThenAnalyzeFromBytes,
} from "./analyze";
import { DEFAULT_TARGET_PERSON } from "./types";
import { saveError, saveOutcome } from "./store";
import { parsePhotoCoverage, type PhotoCoverage } from "./result";

const generationById = new Map<string, number>();

function isCurrent(id: string, generation: number): boolean {
  return generationById.get(id) === generation;
}

export async function runPhotoAnalysis(
  id: string,
  bytes: Buffer,
  opts?: {
    targetPerson?: string;
    declaredContext?: Record<string, unknown>;
    requestedCoverage?: PhotoCoverage;
  },
): Promise<void> {
  const generation = (generationById.get(id) ?? 0) + 1;
  generationById.set(id, generation);

  const started = Date.now();
  try {
    const { gate, analysis } = await preflightThenAnalyzeFromBytes(bytes, {
      targetPerson: opts?.targetPerson?.trim() || DEFAULT_TARGET_PERSON,
      declaredContext: opts?.declaredContext ?? {},
      requestedCoverage: parsePhotoCoverage(opts?.requestedCoverage),
      allowPartialAnalysis: false,
    });
    if (!isCurrent(id, generation)) return;
    await saveOutcome({
      id,
      gate,
      result: analysis,
      ms: Date.now() - started,
      model: analysis ? photoAnalysisModel() : photoPreflightModel(),
    });
  } catch (error) {
    if (!isCurrent(id, generation)) return;
    const message =
      error instanceof Error ? error.message : "Photo analysis failed";
    await saveError(id, message, Date.now() - started, photoPreflightModel());
  }
}
