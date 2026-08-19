/**
 * Isolated photo-analysis runner. Results are stored and displayed only.
 * Do not import this from fashion-memory, hard-drops, scoring, or curation.
 */
import { analyzeGptFromBytes, photoAnalysisGptModel } from "./gpt-analyze";
import { analyzeSpecFromBytes } from "./spec-analyze";
import {
  markDone,
  saveGptError,
  saveGptResult,
  saveSpecError,
  saveSpecResult,
} from "./store";

const generationById = new Map<string, number>();

function isCurrent(id: string, generation: number): boolean {
  return generationById.get(id) === generation;
}

export async function runPhotoAnalysis(
  id: string,
  bytes: Buffer,
): Promise<void> {
  const generation = (generationById.get(id) ?? 0) + 1;
  generationById.set(id, generation);

  const specStarted = Date.now();
  try {
    const spec = await analyzeSpecFromBytes(bytes);
    if (!isCurrent(id, generation)) return;
    await saveSpecResult(id, spec, Date.now() - specStarted);
  } catch (error) {
    if (!isCurrent(id, generation)) return;
    const message = error instanceof Error ? error.message : "Spec analysis failed";
    await saveSpecError(id, message, Date.now() - specStarted);
  }

  const gptStarted = Date.now();
  const model = photoAnalysisGptModel();
  try {
    const gpt = await analyzeGptFromBytes(bytes);
    if (!isCurrent(id, generation)) return;
    await saveGptResult(id, gpt, Date.now() - gptStarted, gpt.engine || model);
  } catch (error) {
    if (!isCurrent(id, generation)) return;
    const message = error instanceof Error ? error.message : "GPT analysis failed";
    await saveGptError(id, message, Date.now() - gptStarted, model);
  }

  if (!isCurrent(id, generation)) return;
  await markDone(id);
}
