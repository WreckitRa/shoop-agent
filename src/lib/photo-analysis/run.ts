/**
 * Isolated photo-analysis runner. Results are stored and displayed only.
 * Do not import this from fashion-memory, hard-drops, scoring, or curation.
 */
import { jpegDataUrlLow, jpegDataUrlOriginal } from "./decode";
import {
  analyzeStylePhotos,
  photoAnalysisModel,
  photoPreflightModel,
  preflightStylePhotos,
} from "./analyze";
import { DEFAULT_TARGET_PERSON } from "./types";
import { saveError, saveGate, saveOutcome } from "./store";
import { startPhotoJobHeartbeat } from "./job-heartbeat";
import {
  facePhotoAccepted,
  parsePhotoCoverage,
  type PhotoCoverage,
} from "./result";
import { logFitting } from "@/lib/onboarding/fitting-trace";

const generationById = new Map<string, number>();

function isCurrent(id: string, generation: number): boolean {
  return generationById.get(id) === generation;
}

function bumpGeneration(id: string): number {
  const generation = (generationById.get(id) ?? 0) + 1;
  generationById.set(id, generation);
  return generation;
}

export async function runPhotoPreflight(
  id: string,
  bytes: Buffer,
  opts?: {
    targetPerson?: string;
    requestedCoverage?: PhotoCoverage;
  },
): Promise<{ accepted: boolean }> {
  const generation = bumpGeneration(id);
  const started = Date.now();
  logFitting("photo_analysis.start", {
    id,
    bytes: bytes.length,
    targetPerson: opts?.targetPerson ?? null,
    requestedCoverage: opts?.requestedCoverage ?? null,
  });
  const stopBeat = startPhotoJobHeartbeat(id, "analysis");
  try {
    const gate = await preflightStylePhotos({
      imageUrls: [await jpegDataUrlLow(bytes)],
      targetPerson: opts?.targetPerson?.trim() || DEFAULT_TARGET_PERSON,
      requestedCoverage: parsePhotoCoverage(opts?.requestedCoverage),
      allowPartialAnalysis: false,
    });
    if (!isCurrent(id, generation)) return { accepted: false };
    const accepted = facePhotoAccepted(gate);
    logFitting("photo_analysis.gate", {
      id,
      ms: Date.now() - started,
      accepted,
      decision: gate.decision,
      next_action: gate.next_action,
    });
    if (!accepted) {
      await saveOutcome({
        id,
        gate,
        result: null,
        ms: Date.now() - started,
        model: photoPreflightModel(),
      });
      return { accepted: false };
    }
    await saveGate({
      id,
      gate,
      ms: Date.now() - started,
      model: photoPreflightModel(),
    });
    return { accepted: true };
  } catch (error) {
    if (!isCurrent(id, generation)) return { accepted: false };
    const message =
      error instanceof Error ? error.message : "Photo analysis failed";
    logFitting("photo_analysis.error", {
      id,
      ms: Date.now() - started,
      error: message,
    });
    await saveError(id, message, Date.now() - started, photoPreflightModel());
    return { accepted: false };
  } finally {
    stopBeat();
  }
}

export async function runPhotoDetail(
  id: string,
  bytes: Buffer,
  opts?: {
    targetPerson?: string;
    declaredContext?: Record<string, unknown>;
    requestedCoverage?: PhotoCoverage;
  },
): Promise<void> {
  const generation = generationById.get(id) ?? bumpGeneration(id);
  const started = Date.now();
  const stopBeat = startPhotoJobHeartbeat(id, "analysis");
  try {
    const requestedCoverage = parsePhotoCoverage(opts?.requestedCoverage);
    const analysis = await analyzeStylePhotos({
      imageUrls: [await jpegDataUrlOriginal(bytes)],
      targetPerson: opts?.targetPerson?.trim() || DEFAULT_TARGET_PERSON,
      requestedCoverage,
      declaredContext: opts?.declaredContext ?? {},
    });
    if (!isCurrent(id, generation)) return;
    logFitting("photo_analysis.done", {
      id,
      ms: Date.now() - started,
      analysis,
    });
    await saveOutcome({
      id,
      result: analysis,
      ms: Date.now() - started,
      model: photoAnalysisModel(),
      keepGate: true,
    });
  } catch (error) {
    if (!isCurrent(id, generation)) return;
    const message =
      error instanceof Error ? error.message : "Photo analysis failed";
    logFitting("photo_analysis.error", {
      id,
      ms: Date.now() - started,
      error: message,
    });
    await saveError(id, message, Date.now() - started, photoAnalysisModel());
  } finally {
    stopBeat();
  }
}

/** Full gate + Terra. Used by force re-runs that wait on the request. */
export async function runPhotoAnalysis(
  id: string,
  bytes: Buffer,
  opts?: {
    targetPerson?: string;
    declaredContext?: Record<string, unknown>;
    requestedCoverage?: PhotoCoverage;
  },
): Promise<void> {
  const { accepted } = await runPhotoPreflight(id, bytes, opts);
  if (!accepted) return;
  await runPhotoDetail(id, bytes, opts);
}
