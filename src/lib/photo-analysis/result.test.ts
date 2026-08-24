import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_IMAGE_PREFLIGHT,
  parseStylePhotoAnalysis,
  parseStylePhotoPreflight,
  shouldRunDetailedAnalysis,
  STYLE_PHOTO_ANALYSIS_ROOT_KEYS,
} from "./result";
import { STYLE_PHOTO_ANALYSIS_SCHEMA, STYLE_PHOTO_PREFLIGHT_SCHEMA } from "./prompt";

describe("style photo analysis parse", () => {
  it("rejects payloads missing required roots", () => {
    assert.equal(parseStylePhotoAnalysis({}), null);
    assert.equal(parseStylePhotoAnalysis({ analysis_status: { usable: true } }), null);
  });

  it("accepts a complete root object", () => {
    const raw: Record<string, unknown> = {
      analysis_status: { usable: false, summary: "no person" },
      capture_quality: {},
      declared_context_used: {},
      visible_profile: {},
      outfit_analysis: [],
      preliminary_styling_implications: [],
      missing_information: [],
      follow_up_questions: [],
      requested_measurements: [],
      requested_additional_photos: [],
      final_summary: {},
    };
    const parsed = parseStylePhotoAnalysis(raw);
    assert.ok(parsed);
    assert.equal(parsed.analysis_status.usable, false);
  });

  it("keeps the OpenAI schema strict", () => {
    assert.equal(STYLE_PHOTO_ANALYSIS_SCHEMA.additionalProperties, false);
    assert.deepEqual(
      [...STYLE_PHOTO_ANALYSIS_SCHEMA.required],
      [...STYLE_PHOTO_ANALYSIS_ROOT_KEYS],
    );
    assert.ok(
      STYLE_PHOTO_ANALYSIS_SCHEMA.properties.analysis_status.required.includes(
        "requested_coverage",
      ),
    );
    assert.ok(
      STYLE_PHOTO_PREFLIGHT_SCHEMA.required.includes("requested_coverage"),
    );
    assert.ok(
      STYLE_PHOTO_PREFLIGHT_SCHEMA.required.includes("highest_supported_coverage"),
    );
  });
});

describe("style photo preflight", () => {
  it("returns the empty-upload reject without calling a model", () => {
    assert.equal(EMPTY_IMAGE_PREFLIGHT.decision, "reject");
    assert.equal(EMPTY_IMAGE_PREFLIGHT.next_action, "stop");
  });

  it("parses a valid gate and rejects junk", () => {
    const gate = {
      decision: "request_retake",
      next_action: "ask_for_better_photos",
      person_presence: "one",
      target_unambiguous: true,
      photo_type: "real_person_photo",
      requested_coverage: "full_body",
      coverage_satisfied: false,
      highest_supported_coverage: "upper_body",
      body_visibility: "upper_body",
      face_visibility: "clear",
      supported_analyses: ["face_geometry"],
      reason_codes: ["body_cropped"],
      missing_requirements: ["A head-to-toe photo"],
      user_message: "Please send a full-length photo standing straight on.",
      confidence: 0.8,
    };
    assert.equal(parseStylePhotoPreflight(gate)?.decision, "request_retake");
    assert.equal(
      parseStylePhotoPreflight(gate)?.requested_coverage,
      "full_body",
    );
    const legacy = { ...gate };
    delete (legacy as { requested_coverage?: string }).requested_coverage;
    delete (legacy as { coverage_satisfied?: boolean }).coverage_satisfied;
    delete (legacy as { highest_supported_coverage?: string })
      .highest_supported_coverage;
    const filled = parseStylePhotoPreflight(legacy);
    assert.equal(filled?.highest_supported_coverage, "upper_body");
    assert.equal(filled?.coverage_satisfied, false);
    assert.equal(parseStylePhotoPreflight({ decision: "nope" }), null);
  });

  it("runs Terra only on full accept, or partial when explicitly allowed", () => {
    assert.equal(
      shouldRunDetailedAnalysis({ next_action: "run_full_analysis" }, false),
      true,
    );
    assert.equal(
      shouldRunDetailedAnalysis({ next_action: "run_partial_analysis" }, false),
      false,
    );
    assert.equal(
      shouldRunDetailedAnalysis({ next_action: "run_partial_analysis" }, true),
      true,
    );
    assert.equal(shouldRunDetailedAnalysis({ next_action: "stop" }, true), false);
  });
});
