import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstIncompleteFittingStep,
  resolveFittingResumeStep,
  shouldAutoResumeFitting,
  type ResumeStatus,
} from "./resume-step";

function status(partial: {
  started?: boolean;
  completed?: boolean;
  profile?: Partial<NonNullable<ResumeStatus["profile"]>> | null;
  sizing?: ResumeStatus["sizing"];
  tasteTags?: ResumeStatus["tasteTags"];
  brandPreferences?: unknown[];
  hardNegatives?: unknown[];
}): ResumeStatus {
  return {
    onboarding: {
      started: partial.started ?? true,
      completed: partial.completed ?? false,
    },
    profile: partial.profile === null ? null : {
      preferredName: null,
      genderPresentation: null,
      styleEra: null,
      ageRange: null,
      weekIs: null,
      dressingFor: null,
      kids: null,
      climate: null,
      valuePhilosophy: null,
      honestyPreference: null,
      styleFriction: null,
      styleBecome: null,
      ...partial.profile,
    },
    sizing: partial.sizing ?? null,
    tasteTags: partial.tasteTags ?? [],
    brandPreferences: partial.brandPreferences ?? [],
    hardNegatives: partial.hardNegatives ?? [],
  };
}

const you = {
  preferredName: "Maya",
  genderPresentation: "feminine",
  styleEra: "30s",
};

describe("firstIncompleteFittingStep", () => {
  it("starts at consent when Fitting has not started, photo when complete", () => {
    assert.equal(
      firstIncompleteFittingStep(status({ started: false })),
      "consent",
    );
    assert.equal(
      firstIncompleteFittingStep(status({ completed: true, profile: you })),
      "photo",
    );
  });

  it("does not skip honesty/nolist just because worn tags exist", () => {
    assert.equal(
      firstIncompleteFittingStep(
        status({
          profile: {
            ...you,
            weekIs: "office",
            valuePhilosophy: "quality",
          },
          sizing: { heightCm: 170, bodyType: "average" },
          tasteTags: [{ category: "worn" }],
        }),
      ),
      "corner",
    );
  });

  it("stays on honesty after no-list until honesty is actually saved", () => {
    assert.equal(
      firstIncompleteFittingStep(
        status({
          profile: {
            ...you,
            weekIs: "office",
            valuePhilosophy: "quality",
            styleBecome: "more tailored",
          },
          sizing: { heightCm: 170, bodyType: "average" },
          tasteTags: [{ category: "worn" }],
          brandPreferences: [{ brand: "COS" }],
        }),
      ),
      "honesty",
    );
  });

  it("lands on verdict after honesty, not on circle", () => {
    assert.equal(
      firstIncompleteFittingStep(
        status({
          profile: {
            ...you,
            weekIs: "office",
            valuePhilosophy: "quality",
            styleBecome: "more tailored",
            honestyPreference: "3",
          },
          sizing: { heightCm: 170, bodyType: "average" },
          tasteTags: [{ category: "worn" }],
          brandPreferences: [{ brand: "COS" }],
        }),
      ),
      "verdict",
    );
  });
});

describe("resolveFittingResumeStep", () => {
  it("restarts at photo when Fitting is complete or explicitly replayed", () => {
    const done = status({ completed: true, profile: you });
    assert.equal(resolveFittingResumeStep(done, "circle"), "photo");
    assert.equal(
      resolveFittingResumeStep(
        status({ profile: you }),
        "circle",
        { restart: true },
      ),
      "photo",
    );
  });

  it("keeps a mid-flow session on verdict instead of clamping to circle", () => {
    const almost = status({
      profile: {
        ...you,
        weekIs: "office",
        valuePhilosophy: "quality",
        honestyPreference: "straight",
        styleBecome: "more tailored",
      },
      sizing: { heightCm: 170, bodyType: "average" },
      tasteTags: [{ category: "worn" }, { category: "aspirational" }],
    });
    assert.equal(resolveFittingResumeStep(almost, "verdict"), "verdict");
    assert.equal(resolveFittingResumeStep(almost, "circle"), "circle");
  });

  it("does not let a stale early session undo saved progress", () => {
    assert.equal(
      resolveFittingResumeStep(
        status({
          profile: { ...you, weekIs: "office" },
        }),
        "photo",
      ),
      "fit",
    );
  });
});

describe("shouldAutoResumeFitting", () => {
  it("resumes only an undismissed in-progress session", () => {
    assert.equal(
      shouldAutoResumeFitting({
        completed: false,
        replay: false,
        sessionDismissed: false,
        hasSession: true,
      }),
      true,
    );
  });

  it("stays closed for first visit, completed, and dismissed", () => {
    assert.equal(
      shouldAutoResumeFitting({
        completed: false,
        replay: false,
        sessionDismissed: false,
        hasSession: false,
      }),
      false,
    );
    assert.equal(
      shouldAutoResumeFitting({
        completed: true,
        replay: false,
        sessionDismissed: false,
        hasSession: true,
      }),
      false,
    );
    assert.equal(
      shouldAutoResumeFitting({
        completed: false,
        replay: false,
        sessionDismissed: true,
        hasSession: true,
      }),
      false,
    );
  });

  it("reopens when the shopper asks to replay Fitting", () => {
    assert.equal(
      shouldAutoResumeFitting({
        completed: true,
        replay: true,
        sessionDismissed: true,
        hasSession: false,
      }),
      true,
    );
  });
});
