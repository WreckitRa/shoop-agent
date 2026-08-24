import type {
  PhotoCoverage,
  StylePhotoAnalysis,
  StylePhotoPreflight,
} from "./result";
import { parsePhotoCoverage } from "./result";
import type { StyleUserReview } from "./review";
import type { StylistVerdict } from "./verdict";

export type PhotoAnalysisPublic = {
  id: string;
  photoHash: string;
  status: string;
  gate: StylePhotoPreflight | null;
  result: StylePhotoAnalysis | null;
  userReview: StyleUserReview | null;
  verdict: StylistVerdict | null;
  verdictStatus: string;
  verdictError: string | null;
  verdictMs: number | null;
  verdictModel: string | null;
  error: string | null;
  ms: number | null;
  model: string | null;
  engineVersion: string;
  createdAt: string;
};

export const PHOTO_ANALYSIS_ENGINE_VERSION = "style-photo-v4";
export const DEFAULT_TARGET_PERSON = "the only person in all images";

export function fillPhotoAnalysisForm(
  form: FormData,
  opts: {
    photo: Blob;
    declaredContext?: Record<string, unknown>;
    targetPerson?: string;
    requestedCoverage?: PhotoCoverage;
  },
) {
  form.append("photo", opts.photo);
  form.append(
    "target_person",
    opts.targetPerson?.trim() || DEFAULT_TARGET_PERSON,
  );
  form.append(
    "requested_coverage",
    parsePhotoCoverage(opts.requestedCoverage),
  );
  const ctx = opts.declaredContext ?? {};
  if (Object.keys(ctx).length) {
    form.append("declared_context", JSON.stringify(ctx));
  }
}
