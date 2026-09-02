/**
 * Cheap first-pass gate. It does not perform styling analysis; it decides
 * whether paying for the detailed call is justified.
 */
export const STYLE_PHOTO_PREFLIGHT_INSTRUCTIONS = String.raw`
You are a fast, conservative image-validation classifier for a personal-styling
application. Do not perform styling analysis and do not describe the person's
appearance. Return only the small structured result required by the schema.

TASK
Decide whether the supplied image set is suitable to send to a more expensive
personal-style vision analysis.

CHECK ONLY
1. Whether the input shows a real person. Accept a camera photo or a screenshot
   / export of a photograph when a single clear face is visible. Reject
   illustrations, product-only images, blank images, documents, UI screenshots
   (apps, chats, websites), collages, and unrelated scenes. Do not reject a
   studio or phone headshot because it was saved as a screenshot.
2. Whether a person is visibly present.
3. Whether exactly one intended target is unambiguous. If several people appear,
   use the target description supplied by the user; if it does not resolve the
   target, treat the target as ambiguous.
4. Whether the photograph satisfies the requested coverage: face, face plus upper
   body, or full body. Report the actual body visibility separately.
5. Whether blur, darkness, overexposure, crop, distance, occlusion, extreme pose,
   camera angle, fisheye/wide-angle distortion, filters, collage layout, mirror
   distortion, or very loose/layered clothing materially blocks analysis.
6. Which later analyses are supportable: face geometry, color-condition check,
   hair/grooming, body proportions, posture, garment fit, and current outfit.

REQUESTED COVERAGE
- face: Require a clear face with hairline and jaw sufficiently visible for face,
  colouring, hair, and grooming analysis. Do not require the body.
- upper_body: Require a clear face plus shoulders, chest, waist, and hips enough
  to assess the visible frame and torso. Do not require the legs.
- full_body: Require a clear face plus the head-to-toe body, including both feet,
  enough to assess visible full-body proportions.
- Set highest_supported_coverage to the most complete route the photograph can
  responsibly support. Every route requires a usable face; upper_body additionally
  requires shoulders through hips, and full_body additionally requires both legs
  and feet. Set coverage_satisfied by comparing that result with requested_coverage.

DECISION RULES
- accept_full: A single unambiguous target is present, image quality is usable,
  and the photograph fully satisfies the requested coverage. "Full" means the
  requested route is satisfied; it does not always mean a full-body photograph.
- accept_partial: A single unambiguous target is present and at least one useful
  analysis is possible, but the photograph provides less coverage than requested.
  Use this only if the application explicitly allows a route downgrade.
- request_retake: A person is present, but missing views or correctable quality,
  crop, pose, clothing, or lighting problems make it wasteful to run the detailed
  analysis now.
- reject: No person is present; the target is ambiguous; the input is unrelated,
  unintelligible, or not a suitable photograph; or nothing useful can be analyzed.

CONSERVATISM
- This is a gate, not a critic. Use neutral language.
- Do not identify the person.
- Do not infer age, ethnicity, nationality, religion, health, disability, income,
  occupation, personality, attractiveness, sexual orientation, or gender identity.
- Do not estimate measurements, height, weight, or body composition.
- Do not reject because of the person's body, coloring, clothing taste, disability,
  or attractiveness. Reject or request a retake only for task relevance,
  ambiguity, visibility, or capture quality.
- Low-detail processing can miss fine features. If uncertain, say uncertain and
  request a clearer photo instead of inventing certainty.
- Keep reason_codes minimal. The user_message must be one short, actionable
  sentence and must not mention models, tokens, cost, schemas, or internal routing.
`;

export const STYLE_PHOTO_PREFLIGHT_SCHEMA_NAME = "style_photo_preflight";

export const STYLE_PHOTO_PREFLIGHT_SCHEMA_DESCRIPTION =
  "Low-cost routing decision for personal-style image inputs.";

export const STYLE_PHOTO_PREFLIGHT_SCHEMA = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      enum: ["accept_full", "accept_partial", "request_retake", "reject"],
    },
    next_action: {
      type: "string",
      enum: [
        "run_full_analysis",
        "run_partial_analysis",
        "ask_for_better_photos",
        "stop",
      ],
    },
    person_presence: {
      type: "string",
      enum: ["none", "one", "multiple", "uncertain"],
    },
    target_unambiguous: { type: "boolean" },
    photo_type: {
      type: "string",
      enum: [
        "real_person_photo",
        "illustration_or_generated",
        "product_or_object",
        "document_or_screenshot",
        "unrelated_scene",
        "unintelligible",
      ],
    },
    requested_coverage: {
      type: "string",
      enum: ["face", "upper_body", "full_body"],
    },
    coverage_satisfied: { type: "boolean" },
    highest_supported_coverage: {
      type: "string",
      enum: ["face", "upper_body", "full_body", "none", "uncertain"],
    },
    body_visibility: {
      type: "string",
      enum: [
        "head_only",
        "upper_body",
        "three_quarter",
        "head_to_toe",
        "none",
        "uncertain",
      ],
    },
    face_visibility: {
      type: "string",
      enum: ["clear", "partly_visible", "not_visible", "uncertain"],
    },
    supported_analyses: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "face_geometry",
          "color_conditions",
          "hair_and_grooming",
          "body_proportions",
          "posture",
          "garment_fit",
          "current_outfit",
        ],
      },
    },
    reason_codes: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "valid",
          "no_person",
          "multiple_people",
          "ambiguous_target",
          "not_a_real_person_photo",
          "unrelated_content",
          "unintelligible_image",
          "face_hidden",
          "body_cropped",
          "subject_too_small",
          "blurred",
          "too_dark",
          "overexposed",
          "strong_color_cast",
          "heavy_filter_or_retouching",
          "extreme_camera_angle",
          "extreme_pose",
          "perspective_or_fisheye_distortion",
          "major_occlusion",
          "clothing_blocks_proportions",
          "collage_or_composite",
          "missing_required_views",
          "low_detail_uncertainty",
        ],
      },
    },
    missing_requirements: { type: "array", items: { type: "string" } },
    user_message: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "decision",
    "next_action",
    "person_presence",
    "target_unambiguous",
    "photo_type",
    "requested_coverage",
    "coverage_satisfied",
    "highest_supported_coverage",
    "body_visibility",
    "face_visibility",
    "supported_analyses",
    "reason_codes",
    "missing_requirements",
    "user_message",
    "confidence",
  ],
  additionalProperties: false,
} as const;

/**
 * Production prompt for evidence-controlled personal-style photo analysis.
 *
 * The image call is limited to visible, fit-relevant evidence. Lifestyle,
 * goals, budget, measurements, and preferences are follow-up questions —
 * never guessed from appearance. Display only; never consumed by search.
 */
export const STYLE_PHOTO_ANALYSIS_INSTRUCTIONS = String.raw`
You are a senior menswear personal stylist, image consultant, garment-fit analyst,
and careful visual assessor. Analyze the supplied image or images to build the
photo-derived portion of a personal style profile.

Your standard is evidence control, not confidence theater. A useful null is better
than an attractive invention.

PRIMARY OBJECTIVE
1. Assess whether the images are suitable for face, color, proportion, posture,
   garment-fit, grooming, and current-style analysis.
2. Extract only visually supported, styling-relevant observations.
3. Separate direct observations from hypotheses.
4. Explain material photographic limitations.
5. Produce cautious preliminary styling implications.
6. Generate the missing questions, measurements, and additional-photo requests
   needed before final recommendations can be made.

TARGET PERSON
- Analyze only the person identified in the user message.
- If multiple people are present and the target is not unambiguous, mark the
  analysis unusable. Do not guess which person is intended.
- Do not identify a real person or compare the subject with a named celebrity.

COVERAGE ROUTING
- The user payload contains requested_coverage: face, upper_body, or full_body.
- For face, analyze face geometry, colouring conditions, hair, grooming, and other
  genuinely visible evidence. Return null for body and leg observations and ask
  for the missing body attributes in the follow-up intake.
- For upper_body, additionally analyze visible frame, shoulders, chest, waist,
  hips, torso proportions, posture, and upper-garment fit. Return null for unseen
  lower-body and leg observations and request those attributes from the user.
- For full_body, analyze all supportable face, upper-body, lower-body, posture,
  and garment-fit evidence. Full-body coverage never authorizes guessing through
  clothing, occlusion, pose, or perspective distortion.
- Actual visibility always overrides the selected route. If the selected coverage
  is not present, say so rather than pretending the requested evidence exists.

VISUAL EVIDENCE RULES
- First assess the capture, then assess the person. Check framing, crop, resolution,
  lighting direction, exposure, flash, color cast, white balance, shadows, camera
  height, camera tilt, subject distance, wide-angle or perspective distortion,
  pose, stance, weight distribution, foreshortening, occlusion, garment bulk,
  compression artifacts, filters, retouching, and mirror distortion.
- Do not silently "correct" these effects. State their likely effect, lower the
  relevant confidence, and return null when they prevent a responsible assessment.
- Treat visible evidence and hidden anatomy as different things. Never infer a
  concealed waist, chest, hip, leg line, shoulder position, or body composition
  through loose, padded, layered, dark, cropped, or heavily patterned clothing.
- Do not mistake shadows for muscle definition, garment folds for body contours,
  a tilted pose for structural asymmetry, or a low/wide camera for long legs or a
  broad upper body.
- Do not estimate exact height, weight, body-fat percentage, age, or body
  measurements from pixels. Use user-declared values when provided and label them
  as declared, never visually verified.
- For every assessment, cite concise visible evidence. If the feature is not
  visible, use value=null, confidence=0, evidence="not observable from supplied
  images", and list the blocking factors in caveats.
- Confidence is evidence-specific: 0.90-1.00 very clear across suitable views;
  0.70-0.89 clear but not measured; 0.40-0.69 plausible and materially affected by
  capture or clothing; 0.01-0.39 weak; 0 not observable.

COLOR RULES
- Distinguish recorded surface color from undertone hypotheses.
- Consider exposure, flash, colored walls, mixed lighting, tanning, makeup, image
  processing, and white balance before assessing skin, hair, eyes, contrast,
  temperature, value, or chroma.
- A single uncontrolled photo cannot establish a definitive seasonal palette.
  Return a tentative direction or null and request controlled daylight/draping
  images when appropriate.
- Do not use ethnicity as a shortcut for color analysis.

FACE, HAIR, AND GROOMING RULES
- Analyze only visible geometry and styling-relevant relationships: apparent face
  shape, length-to-width balance, forehead, cheekbones, jaw, chin, hair shape,
  texture pattern, visible density, facial-hair shape, and eyewear geometry.
- Account for expression, head rotation, facial hair, hair covering the forehead,
  and perspective. Do not diagnose hair loss, skin conditions, or health.

BODY AND FIT RULES
- Analyze relative visual proportions only when the required landmarks are visible:
  visual frame, shoulder width and slope, chest-to-waist relationship,
  waist-to-hip relationship, torso-to-leg balance, relative arm length, neck
  length, vertical balance, posture, stance, and visible muscular distribution.
- Use neutral, nonjudgmental language. Describe styling opportunities, not flaws.
- Analyze the garment separately from the body. For each visible garment, inspect
  shoulder placement, pulling, collapsing, excess fabric, sleeve and body length,
  rise, seat, thigh, taper, break, hem, and intended silhouette where observable.
- Do not call a relaxed or oversized garment a bad fit merely because it is not
  slim. Infer the intended silhouette cautiously.

STYLE RULES
- Do not infer personality, occupation, income, status, religion, ethnicity,
  nationality, health, disability, sexual orientation, or gender identity from
  appearance.
- You may use user-declared menswear/gender-presentation context only to choose the
  relevant clothing vocabulary.
- Do not give an attractiveness score.
- Treat body-shape labels as optional shorthand, never as destiny.
- Recommendations must be provisional until lifestyle, desired image, comfort,
  taste, climate, wardrobe, budget, shopping access, maintenance tolerance,
  measurements, and fit preference are supplied.
- Prefer language such as "likely to support the stated goal" and "test in a
  fitting" over absolute rules such as "never wear".

FOLLOW-UP INTAKE
Generate concise, nonduplicative questions that recover all missing high-value
information. Cover, when not already declared: reason for styling now; desired and
undesired impression; important audiences; real weekly situations and dress codes;
climate/location; favorite and disliked outfits; saved references and what is liked
in each; repeated fit problems; preferred ease; comfort and sensory limits;
mobility/footwear needs; current wardrobe winners, unworn items, and gaps; grooming
willingness; total budget and item-level ceilings; preferred quality level;
tailoring willingness; stores/brands and shopping geography; returns/import access;
laundry/ironing/dry-cleaning tolerance; travel; upcoming events; and expected body
or lifestyle changes.

Ask for only measurements that will materially improve clothing recommendations.
Normally include declared height and weight trend, neck, shoulder width, chest,
waist at navel, trouser waist position, seat/hips, thigh, inseam, sleeve, bicep,
wrist, shoe size, and shoe width, plus the measurements of one well-fitting shirt,
trouser, and jacket when available.

Return only the structured result required by the supplied JSON Schema. Do not add
markdown, prose outside the schema, or hidden chain-of-thought.
`;

export const STYLE_PHOTO_ANALYSIS_SCHEMA_NAME =
  "professional_style_photo_analysis";

export const STYLE_PHOTO_ANALYSIS_SCHEMA_DESCRIPTION =
  "Evidence-controlled visible appearance, body proportion, fit, and missing-intake analysis.";

const ASSESSMENT = {
  type: "object",
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "string" },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["value", "confidence", "evidence", "caveats"],
  additionalProperties: false,
} as const;

const ASSESSMENT_REF = { $ref: "#/$defs/assessment" } as const;

export const STYLE_PHOTO_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    analysis_status: {
      type: "object",
      properties: {
        schema_version: { type: "string" },
        usable: { type: "boolean" },
        overall_confidence: { type: "number", minimum: 0, maximum: 1 },
        analyzed_image_count: { type: "integer", minimum: 0 },
        visible_person_count: { type: "integer", minimum: 0 },
        target_selection: { type: "string" },
        requested_coverage: {
          type: "string",
          enum: ["face", "upper_body", "full_body"],
        },
        achieved_coverage: {
          type: "string",
          enum: ["face", "upper_body", "full_body", "none", "uncertain"],
        },
        coverage_complete: { type: "boolean" },
        summary: { type: "string" },
        refusal_or_failure_reason: { type: ["string", "null"] },
      },
      required: [
        "schema_version",
        "usable",
        "overall_confidence",
        "analyzed_image_count",
        "visible_person_count",
        "target_selection",
        "requested_coverage",
        "achieved_coverage",
        "coverage_complete",
        "summary",
        "refusal_or_failure_reason",
      ],
      additionalProperties: false,
    },
    capture_quality: {
      type: "object",
      properties: {
        views_present: { type: "array", items: { type: "string" } },
        visible_regions: { type: "array", items: { type: "string" } },
        face_analysis_reliability: {
          type: "string",
          enum: ["high", "medium", "low", "unusable"],
        },
        color_analysis_reliability: {
          type: "string",
          enum: ["high", "medium", "low", "unusable"],
        },
        proportion_analysis_reliability: {
          type: "string",
          enum: ["high", "medium", "low", "unusable"],
        },
        garment_fit_reliability: {
          type: "string",
          enum: ["high", "medium", "low", "unusable"],
        },
        lighting: ASSESSMENT_REF,
        exposure_and_flash: ASSESSMENT_REF,
        white_balance: ASSESSMENT_REF,
        camera_height_and_tilt: ASSESSMENT_REF,
        perspective_and_lens: ASSESSMENT_REF,
        pose_and_weight_distribution: ASSESSMENT_REF,
        filters_or_retouching: ASSESSMENT_REF,
        occlusions: { type: "array", items: { type: "string" } },
        artifact_risks: { type: "array", items: { type: "string" } },
      },
      required: [
        "views_present",
        "visible_regions",
        "face_analysis_reliability",
        "color_analysis_reliability",
        "proportion_analysis_reliability",
        "garment_fit_reliability",
        "lighting",
        "exposure_and_flash",
        "white_balance",
        "camera_height_and_tilt",
        "perspective_and_lens",
        "pose_and_weight_distribution",
        "filters_or_retouching",
        "occlusions",
        "artifact_risks",
      ],
      additionalProperties: false,
    },
    declared_context_used: {
      type: "object",
      properties: {
        supplied: { type: "boolean" },
        facts_used: { type: "array", items: { type: "string" } },
        conflicts_or_ambiguities: { type: "array", items: { type: "string" } },
      },
      required: ["supplied", "facts_used", "conflicts_or_ambiguities"],
      additionalProperties: false,
    },
    visible_profile: {
      type: "object",
      properties: {
        color: {
          type: "object",
          properties: {
            visible_skin_surface_tone: ASSESSMENT_REF,
            skin_depth: ASSESSMENT_REF,
            undertone_hypothesis: ASSESSMENT_REF,
            temperature_direction: ASSESSMENT_REF,
            chroma_direction: ASSESSMENT_REF,
            facial_contrast: ASSESSMENT_REF,
            hair_color: ASSESSMENT_REF,
            eye_color: ASSESSMENT_REF,
            preliminary_palette_direction: ASSESSMENT_REF,
            seasonal_palette_hypothesis: ASSESSMENT_REF,
          },
          required: [
            "visible_skin_surface_tone",
            "skin_depth",
            "undertone_hypothesis",
            "temperature_direction",
            "chroma_direction",
            "facial_contrast",
            "hair_color",
            "eye_color",
            "preliminary_palette_direction",
            "seasonal_palette_hypothesis",
          ],
          additionalProperties: false,
        },
        face: {
          type: "object",
          properties: {
            primary_shape: ASSESSMENT_REF,
            secondary_shape_influence: ASSESSMENT_REF,
            length_to_width_balance: ASSESSMENT_REF,
            forehead: ASSESSMENT_REF,
            cheekbones: ASSESSMENT_REF,
            jawline: ASSESSMENT_REF,
            chin: ASSESSMENT_REF,
            face_shape_limitations: { type: "array", items: { type: "string" } },
          },
          required: [
            "primary_shape",
            "secondary_shape_influence",
            "length_to_width_balance",
            "forehead",
            "cheekbones",
            "jawline",
            "chin",
            "face_shape_limitations",
          ],
          additionalProperties: false,
        },
        hair_and_grooming: {
          type: "object",
          properties: {
            hair_length: ASSESSMENT_REF,
            hair_texture_pattern: ASSESSMENT_REF,
            visible_hair_density: ASSESSMENT_REF,
            current_haircut_shape: ASSESSMENT_REF,
            facial_hair_style: ASSESSMENT_REF,
            visible_facial_hair_density: ASSESSMENT_REF,
            eyewear_geometry: ASSESSMENT_REF,
            grooming_cohesion: ASSESSMENT_REF,
          },
          required: [
            "hair_length",
            "hair_texture_pattern",
            "visible_hair_density",
            "current_haircut_shape",
            "facial_hair_style",
            "visible_facial_hair_density",
            "eyewear_geometry",
            "grooming_cohesion",
          ],
          additionalProperties: false,
        },
        body_proportions: {
          type: "object",
          properties: {
            visual_frame: ASSESSMENT_REF,
            body_shape_summary: ASSESSMENT_REF,
            shoulder_width_relative: ASSESSMENT_REF,
            shoulder_slope: ASSESSMENT_REF,
            chest_to_waist_relationship: ASSESSMENT_REF,
            waist_to_hip_relationship: ASSESSMENT_REF,
            torso_to_leg_balance: ASSESSMENT_REF,
            relative_arm_length: ASSESSMENT_REF,
            neck_length_and_width: ASSESSMENT_REF,
            leg_line: ASSESSMENT_REF,
            vertical_balance: ASSESSMENT_REF,
            posture: ASSESSMENT_REF,
            stance: ASSESSMENT_REF,
            apparent_symmetry: ASSESSMENT_REF,
            visible_muscular_distribution: ASSESSMENT_REF,
          },
          required: [
            "visual_frame",
            "body_shape_summary",
            "shoulder_width_relative",
            "shoulder_slope",
            "chest_to_waist_relationship",
            "waist_to_hip_relationship",
            "torso_to_leg_balance",
            "relative_arm_length",
            "neck_length_and_width",
            "leg_line",
            "vertical_balance",
            "posture",
            "stance",
            "apparent_symmetry",
            "visible_muscular_distribution",
          ],
          additionalProperties: false,
        },
        current_style_signals: {
          type: "object",
          properties: {
            silhouette: ASSESSMENT_REF,
            formality: ASSESSMENT_REF,
            color_story: ASSESSMENT_REF,
            aesthetic_signals: ASSESSMENT_REF,
            apparent_fit_intent: ASSESSMENT_REF,
            outfit_cohesion: ASSESSMENT_REF,
          },
          required: [
            "silhouette",
            "formality",
            "color_story",
            "aesthetic_signals",
            "apparent_fit_intent",
            "outfit_cohesion",
          ],
          additionalProperties: false,
        },
      },
      required: [
        "color",
        "face",
        "hair_and_grooming",
        "body_proportions",
        "current_style_signals",
      ],
      additionalProperties: false,
    },
    outfit_analysis: {
      type: "array",
      items: { $ref: "#/$defs/garment_fit" },
    },
    preliminary_styling_implications: {
      type: "array",
      items: { $ref: "#/$defs/styling_implication" },
    },
    missing_information: {
      type: "array",
      items: { $ref: "#/$defs/missing_information" },
    },
    follow_up_questions: {
      type: "array",
      items: { $ref: "#/$defs/follow_up_question" },
    },
    requested_measurements: {
      type: "array",
      items: { $ref: "#/$defs/measurement_request" },
    },
    requested_additional_photos: {
      type: "array",
      items: { $ref: "#/$defs/photo_request" },
    },
    final_summary: {
      type: "object",
      properties: {
        strongest_supported_observations: {
          type: "array",
          items: { type: "string" },
        },
        largest_uncertainties: { type: "array", items: { type: "string" } },
        provisional_style_profile: { type: "string" },
        readiness_for_final_recommendations: {
          type: "string",
          enum: ["ready", "partially_ready", "not_ready"],
        },
        next_best_action: { type: "string" },
      },
      required: [
        "strongest_supported_observations",
        "largest_uncertainties",
        "provisional_style_profile",
        "readiness_for_final_recommendations",
        "next_best_action",
      ],
      additionalProperties: false,
    },
  },
  required: [
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
  ],
  additionalProperties: false,
  $defs: {
    assessment: ASSESSMENT,
    garment_fit: {
      type: "object",
      properties: {
        garment: { type: "string" },
        visible_color: { type: ["string", "null"] },
        intended_silhouette_hypothesis: { type: ["string", "null"] },
        fit_status: {
          type: "string",
          enum: ["good", "mixed", "poor", "unknown"],
        },
        observations: { type: "array", items: { type: "string" } },
        evidence: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        distortion_or_occlusion_risks: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "garment",
        "visible_color",
        "intended_silhouette_hypothesis",
        "fit_status",
        "observations",
        "evidence",
        "confidence",
        "distortion_or_occlusion_risks",
      ],
      additionalProperties: false,
    },
    styling_implication: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: [
            "silhouette",
            "proportion",
            "color",
            "tops",
            "trousers",
            "tailoring",
            "outerwear",
            "fabrics_and_patterns",
            "footwear",
            "hair",
            "facial_hair",
            "eyewear",
            "accessories",
          ],
        },
        direction: {
          type: "string",
          enum: ["prefer", "explore", "use_carefully", "verify_first"],
        },
        guidance: { type: "string" },
        rationale: { type: "string" },
        based_on: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        provisional: { type: "boolean" },
      },
      required: [
        "area",
        "direction",
        "guidance",
        "rationale",
        "based_on",
        "confidence",
        "provisional",
      ],
      additionalProperties: false,
    },
    missing_information: {
      type: "object",
      properties: {
        field: { type: "string" },
        reason_missing: { type: "string" },
        impact_on_recommendations: { type: "string" },
        priority: {
          type: "string",
          enum: ["required", "important", "optional"],
        },
      },
      required: [
        "field",
        "reason_missing",
        "impact_on_recommendations",
        "priority",
      ],
      additionalProperties: false,
    },
    follow_up_question: {
      type: "object",
      properties: {
        id: { type: "string" },
        category: {
          type: "string",
          enum: [
            "goal",
            "desired_image",
            "audience",
            "lifestyle",
            "climate",
            "taste",
            "wardrobe",
            "fit_preference",
            "comfort",
            "grooming",
            "budget",
            "shopping_access",
            "maintenance",
            "travel_and_events",
            "future_changes",
          ],
        },
        question: { type: "string" },
        why_needed: { type: "string" },
        priority: {
          type: "string",
          enum: ["required", "important", "optional"],
        },
        answer_type: {
          type: "string",
          enum: [
            "free_text",
            "single_select",
            "multi_select",
            "number",
            "boolean",
            "image_upload",
          ],
        },
      },
      required: [
        "id",
        "category",
        "question",
        "why_needed",
        "priority",
        "answer_type",
      ],
      additionalProperties: false,
    },
    measurement_request: {
      type: "object",
      properties: {
        measurement: { type: "string" },
        unit: {
          type: "string",
          enum: ["cm", "kg", "shoe_size", "descriptive"],
        },
        priority: {
          type: "string",
          enum: ["required", "important", "optional"],
        },
        reason: { type: "string" },
        instruction: { type: "string" },
      },
      required: [
        "measurement",
        "unit",
        "priority",
        "reason",
        "instruction",
      ],
      additionalProperties: false,
    },
    photo_request: {
      type: "object",
      properties: {
        photo: { type: "string" },
        priority: {
          type: "string",
          enum: ["required", "important", "optional"],
        },
        instructions: { type: "string" },
        purpose: { type: "string" },
      },
      required: ["photo", "priority", "instructions", "purpose"],
      additionalProperties: false,
    },
  },
} as const;
