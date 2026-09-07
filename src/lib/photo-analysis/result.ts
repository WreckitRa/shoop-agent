export type PhotoCoverage = "face" | "upper_body" | "full_body";

export type AchievedCoverage = PhotoCoverage | "none" | "uncertain";

export const PHOTO_COVERAGES: PhotoCoverage[] = [
  "face",
  "upper_body",
  "full_body",
];

export function parsePhotoCoverage(raw: unknown): PhotoCoverage {
  if (raw === "face" || raw === "upper_body" || raw === "full_body") return raw;
  return "full_body";
}

function coverageFromBody(
  body: unknown,
): AchievedCoverage {
  if (body === "head_to_toe") return "full_body";
  if (body === "upper_body" || body === "three_quarter") return "upper_body";
  if (body === "head_only") return "face";
  if (body === "none") return "none";
  return "uncertain";
}

export type PreflightDecision =
  | "accept_full"
  | "accept_partial"
  | "request_retake"
  | "reject";

export type PreflightNextAction =
  | "run_full_analysis"
  | "run_partial_analysis"
  | "ask_for_better_photos"
  | "stop";

export type StylePhotoPreflight = {
  decision: PreflightDecision;
  next_action: PreflightNextAction;
  person_presence: "none" | "one" | "multiple" | "uncertain";
  target_unambiguous: boolean;
  photo_type:
    | "real_person_photo"
    | "illustration_or_generated"
    | "product_or_object"
    | "document_or_screenshot"
    | "unrelated_scene"
    | "unintelligible";
  requested_coverage: PhotoCoverage;
  coverage_satisfied: boolean;
  highest_supported_coverage: AchievedCoverage;
  body_visibility:
    | "head_only"
    | "upper_body"
    | "three_quarter"
    | "head_to_toe"
    | "none"
    | "uncertain";
  face_visibility: "clear" | "partly_visible" | "not_visible" | "uncertain";
  supported_analyses: Array<
    | "face_geometry"
    | "color_conditions"
    | "hair_and_grooming"
    | "body_proportions"
    | "posture"
    | "garment_fit"
    | "current_outfit"
  >;
  reason_codes: string[];
  missing_requirements: string[];
  user_message: string;
  confidence: number;
};

export const EMPTY_IMAGE_PREFLIGHT: StylePhotoPreflight = {
  decision: "reject",
  next_action: "stop",
  person_presence: "none",
  target_unambiguous: false,
  photo_type: "unintelligible",
  requested_coverage: "full_body",
  coverage_satisfied: false,
  highest_supported_coverage: "none",
  body_visibility: "none",
  face_visibility: "not_visible",
  supported_analyses: [],
  reason_codes: ["unintelligible_image"],
  missing_requirements: ["Upload at least one photograph."],
  user_message:
    "Please upload a clear photograph containing the person you want styled.",
  confidence: 1,
};

const PREFLIGHT_DECISIONS = new Set<PreflightDecision>([
  "accept_full",
  "accept_partial",
  "request_retake",
  "reject",
]);

const PREFLIGHT_ACTIONS = new Set<PreflightNextAction>([
  "run_full_analysis",
  "run_partial_analysis",
  "ask_for_better_photos",
  "stop",
]);

export function parseStylePhotoPreflight(
  raw: unknown,
): StylePhotoPreflight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!PREFLIGHT_DECISIONS.has(o.decision as PreflightDecision)) return null;
  if (!PREFLIGHT_ACTIONS.has(o.next_action as PreflightNextAction)) return null;
  if (typeof o.target_unambiguous !== "boolean") return null;
  if (typeof o.user_message !== "string") return null;
  if (typeof o.confidence !== "number") return null;
  if (!Array.isArray(o.supported_analyses)) return null;
  if (!Array.isArray(o.reason_codes)) return null;
  if (!Array.isArray(o.missing_requirements)) return null;
  const requested = parsePhotoCoverage(o.requested_coverage);
  const highest = (
    o.highest_supported_coverage === "face" ||
    o.highest_supported_coverage === "upper_body" ||
    o.highest_supported_coverage === "full_body" ||
    o.highest_supported_coverage === "none" ||
    o.highest_supported_coverage === "uncertain"
      ? o.highest_supported_coverage
      : coverageFromBody(o.body_visibility)
  ) as AchievedCoverage;
  return {
    ...(raw as StylePhotoPreflight),
    requested_coverage: requested,
    coverage_satisfied:
      typeof o.coverage_satisfied === "boolean"
        ? o.coverage_satisfied
        : o.decision === "accept_full",
    highest_supported_coverage: highest,
  };
}

/**
 * Luna often tags a studio headshot as generated/screenshot and stops.
 * A single unambiguous, visible face is enough to pay for Terra.
 */
export function rescueClearFaceGate(
  gate: StylePhotoPreflight,
): StylePhotoPreflight {
  const faceOk =
    gate.person_presence === "one" &&
    gate.target_unambiguous &&
    (gate.face_visibility === "clear" ||
      gate.face_visibility === "partly_visible");
  if (!faceOk) return gate;
  if (
    gate.next_action === "run_full_analysis" ||
    gate.next_action === "run_partial_analysis"
  ) {
    return gate;
  }

  const coverage: AchievedCoverage =
    gate.body_visibility === "head_to_toe"
      ? "full_body"
      : gate.body_visibility === "upper_body" ||
          gate.body_visibility === "three_quarter"
        ? "upper_body"
        : "face";
  const faceRoute = gate.requested_coverage === "face";
  const generatedish =
    gate.photo_type === "illustration_or_generated" ||
    gate.photo_type === "document_or_screenshot";

  return {
    ...gate,
    decision: faceRoute || coverage === gate.requested_coverage
      ? "accept_full"
      : "accept_partial",
    next_action: "run_full_analysis",
    highest_supported_coverage: coverage,
    coverage_satisfied: faceRoute || coverage === gate.requested_coverage,
    photo_type: generatedish ? "real_person_photo" : gate.photo_type,
    reason_codes: gate.reason_codes.filter(
      (code) => code !== "not_a_real_person_photo",
    ),
    supported_analyses:
      gate.supported_analyses.length > 0
        ? gate.supported_analyses
        : ["face_geometry", "color_conditions", "hair_and_grooming"],
  };
}

/** Onboarding does not spend on partial analysis. */
export function shouldRunDetailedAnalysis(
  gate: Pick<StylePhotoPreflight, "next_action">,
  allowPartialAnalysis: boolean,
): boolean {
  return (
    gate.next_action === "run_full_analysis" ||
    (gate.next_action === "run_partial_analysis" && allowPartialAnalysis)
  );
}

export function facePhotoAccepted(
  gate: Pick<StylePhotoPreflight, "next_action"> | null | undefined,
): boolean {
  if (!gate) return false;
  return shouldRunDetailedAnalysis(gate, false);
}

export function facePhotoGateMessage(
  gate: Pick<StylePhotoPreflight, "user_message"> | null | undefined,
): string {
  const msg = gate?.user_message?.trim();
  return msg || "Need a clear photo of your face — just you, facing the light.";
}

export type Assessment = {
  value: string | null;
  confidence: number;
  evidence: string;
  caveats: string[];
};

export type Reliability = "high" | "medium" | "low" | "unusable";

export type AnalysisStatus = {
  schema_version: string;
  usable: boolean;
  overall_confidence: number;
  analyzed_image_count: number;
  visible_person_count: number;
  target_selection: string;
  requested_coverage?: PhotoCoverage;
  achieved_coverage?: AchievedCoverage;
  coverage_complete?: boolean;
  summary: string;
  refusal_or_failure_reason: string | null;
};

export type CaptureQuality = {
  views_present: string[];
  visible_regions: string[];
  face_analysis_reliability: Reliability;
  color_analysis_reliability: Reliability;
  proportion_analysis_reliability: Reliability;
  garment_fit_reliability: Reliability;
  lighting: Assessment;
  exposure_and_flash: Assessment;
  white_balance: Assessment;
  camera_height_and_tilt: Assessment;
  perspective_and_lens: Assessment;
  pose_and_weight_distribution: Assessment;
  filters_or_retouching: Assessment;
  occlusions: string[];
  artifact_risks: string[];
};

export type DeclaredContextUsed = {
  supplied: boolean;
  facts_used: string[];
  conflicts_or_ambiguities: string[];
};

export type VisibleProfile = {
  color: {
    visible_skin_surface_tone: Assessment;
    skin_depth: Assessment;
    undertone_hypothesis: Assessment;
    temperature_direction: Assessment;
    chroma_direction: Assessment;
    facial_contrast: Assessment;
    hair_color: Assessment;
    eye_color: Assessment;
    preliminary_palette_direction: Assessment;
    seasonal_palette_hypothesis: Assessment;
  };
  face: {
    primary_shape: Assessment;
    secondary_shape_influence: Assessment;
    length_to_width_balance: Assessment;
    forehead: Assessment;
    cheekbones: Assessment;
    jawline: Assessment;
    chin: Assessment;
    face_shape_limitations: string[];
  };
  hair_and_grooming: {
    hair_length: Assessment;
    hair_texture_pattern: Assessment;
    visible_hair_density: Assessment;
    current_haircut_shape: Assessment;
    facial_hair_style: Assessment;
    visible_facial_hair_density: Assessment;
    eyewear_geometry: Assessment;
    grooming_cohesion: Assessment;
  };
  body_proportions: {
    visual_frame: Assessment;
    body_shape_summary: Assessment;
    shoulder_width_relative: Assessment;
    shoulder_slope: Assessment;
    chest_to_waist_relationship: Assessment;
    waist_to_hip_relationship: Assessment;
    torso_to_leg_balance: Assessment;
    relative_arm_length: Assessment;
    neck_length_and_width: Assessment;
    leg_line: Assessment;
    vertical_balance: Assessment;
    posture: Assessment;
    stance: Assessment;
    apparent_symmetry: Assessment;
    visible_muscular_distribution: Assessment;
  };
  current_style_signals: {
    silhouette: Assessment;
    formality: Assessment;
    color_story: Assessment;
    aesthetic_signals: Assessment;
    apparent_fit_intent: Assessment;
    outfit_cohesion: Assessment;
  };
};

export type GarmentFit = {
  garment: string;
  visible_color: string | null;
  intended_silhouette_hypothesis: string | null;
  fit_status: "good" | "mixed" | "poor" | "unknown";
  observations: string[];
  evidence: string;
  confidence: number;
  distortion_or_occlusion_risks: string[];
};

export type StylingImplication = {
  area:
    | "silhouette"
    | "proportion"
    | "color"
    | "tops"
    | "trousers"
    | "tailoring"
    | "outerwear"
    | "fabrics_and_patterns"
    | "footwear"
    | "hair"
    | "facial_hair"
    | "eyewear"
    | "accessories";
  direction: "prefer" | "explore" | "use_carefully" | "verify_first";
  guidance: string;
  rationale: string;
  based_on: string[];
  confidence: number;
  provisional: boolean;
};

export type MissingInformation = {
  field: string;
  reason_missing: string;
  impact_on_recommendations: string;
  priority: "required" | "important" | "optional";
};

export type FollowUpQuestion = {
  id: string;
  category:
    | "goal"
    | "desired_image"
    | "audience"
    | "lifestyle"
    | "climate"
    | "taste"
    | "wardrobe"
    | "fit_preference"
    | "comfort"
    | "grooming"
    | "budget"
    | "shopping_access"
    | "maintenance"
    | "travel_and_events"
    | "future_changes";
  question: string;
  why_needed: string;
  priority: "required" | "important" | "optional";
  answer_type:
    | "free_text"
    | "single_select"
    | "multi_select"
    | "number"
    | "boolean"
    | "image_upload";
};

export type MeasurementRequest = {
  measurement: string;
  unit: "cm" | "kg" | "shoe_size" | "descriptive";
  priority: "required" | "important" | "optional";
  reason: string;
  instruction: string;
};

export type PhotoRequest = {
  photo: string;
  priority: "required" | "important" | "optional";
  instructions: string;
  purpose: string;
};

export type FinalSummary = {
  strongest_supported_observations: string[];
  largest_uncertainties: string[];
  provisional_style_profile: string;
  readiness_for_final_recommendations: "ready" | "partially_ready" | "not_ready";
  next_best_action: string;
};

export type StylePhotoAnalysis = {
  analysis_status: AnalysisStatus;
  capture_quality: CaptureQuality;
  declared_context_used: DeclaredContextUsed;
  visible_profile: VisibleProfile;
  outfit_analysis: GarmentFit[];
  preliminary_styling_implications: StylingImplication[];
  missing_information: MissingInformation[];
  follow_up_questions: FollowUpQuestion[];
  requested_measurements: MeasurementRequest[];
  requested_additional_photos: PhotoRequest[];
  final_summary: FinalSummary;
};

export const STYLE_PHOTO_ANALYSIS_ROOT_KEYS = [
  "analysis_status",
  "capture_quality",
  "declared_context_used",
  "visible_profile",
  "outfit_analysis",
  "preliminary_styling_implications",
  "missing_information",
  "follow_up_questions",
  "requested_measurements",
  "requested_additional_photos",
  "final_summary",
] as const;

export function isAssessment(value: unknown): value is Assessment {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    (o.value === null || typeof o.value === "string") &&
    typeof o.confidence === "number" &&
    typeof o.evidence === "string" &&
    Array.isArray(o.caveats)
  );
}

export function parseStylePhotoAnalysis(
  raw: unknown,
): StylePhotoAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const key of STYLE_PHOTO_ANALYSIS_ROOT_KEYS) {
    if (!(key in o)) return null;
  }
  const status = o.analysis_status;
  if (!status || typeof status !== "object") return null;
  if (typeof (status as { usable?: unknown }).usable !== "boolean") return null;
  if (!Array.isArray(o.outfit_analysis)) return null;
  if (!Array.isArray(o.preliminary_styling_implications)) return null;
  if (!Array.isArray(o.missing_information)) return null;
  if (!Array.isArray(o.follow_up_questions)) return null;
  if (!Array.isArray(o.requested_measurements)) return null;
  if (!Array.isArray(o.requested_additional_photos)) return null;
  if (!o.final_summary || typeof o.final_summary !== "object") return null;
  if (!o.visible_profile || typeof o.visible_profile !== "object") return null;
  if (!o.capture_quality || typeof o.capture_quality !== "object") return null;
  return raw as StylePhotoAnalysis;
}
