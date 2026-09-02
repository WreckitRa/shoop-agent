/**
 * Live LLM smoke for Fitting free-text extraction.
 * Run: set -a && source .env && set +a && npx tsx scripts/test-fitting-tell-live.ts
 */
import {
  extractFittingTell,
  resolveHeightCm,
  type FittingTellExtraction,
  type FittingTellStep,
} from "../src/lib/onboarding/fitting-tell";

type Expectation = {
  preferredName?: string | RegExp;
  genderPresentation?: string;
  styleErasIncludes?: string[];
  ageRange?: string;
  ageYears?: number;
  budgetIncludes?: string[];
  brandLikesIncludes?: string[];
  brandAvoidsIncludes?: string[];
  hardAvoidsIncludes?: string[];
  styleLikesIncludes?: string[];
  honestyPreference?: string;
  build?: string;
  muscularity?: string;
  bodyShape?: string;
  heightCmApprox?: number;
  heightCmTolerance?: number;
  weightKgApprox?: number;
  /** Expect little/no structure beyond summary. */
  mostlyEmpty?: boolean;
};

type Case = {
  id: string;
  text: string;
  step?: FittingTellStep;
  expect: Expectation;
};

const CASES: Case[] = [
  {
    id: "name_only",
    step: "name",
    text: "Call me Raphael",
    expect: { preferredName: /raphael/i },
  },
  {
    id: "brands_on_name_step",
    step: "name",
    text: "I'm Alex. I love Everlane and COS, and I never want logos.",
    expect: {
      preferredName: /alex/i,
      brandLikesIncludes: ["Everlane", "COS"],
      hardAvoidsIncludes: ["logo"],
    },
  },
  {
    id: "height_imperial_build",
    step: "photo",
    text: "I'm 5'11\", athletic build, decent muscle definition",
    expect: {
      heightCmApprox: Math.round((5 * 12 + 11) * 2.54),
      heightCmTolerance: 3,
      build: "athletic",
      muscularity: "high",
    },
  },
  {
    id: "height_metric_slim",
    step: "name",
    text: "I'm about 180cm and pretty slim",
    expect: {
      heightCmApprox: 180,
      heightCmTolerance: 2,
      build: "slim",
    },
  },
  {
    id: "spend_luxury",
    step: "spend",
    text: "I shop luxury and designer only",
    expect: { budgetIncludes: ["luxury"] },
  },
  {
    id: "spend_value",
    step: "name",
    text: "I'm a deal hunter, smart value over prestige",
    expect: {
      // either is fine; prefer at least one value-related bucket
      budgetIncludes: ["deal_hunter", "best_value"],
    },
  },
  {
    id: "gender_era",
    step: "name",
    text: "I dress masculine, early thirties era",
    expect: {
      genderPresentation: "masculine",
      styleErasIncludes: ["30s", "23_29"],
    },
  },
  {
    id: "hard_avoids_list",
    step: "nolist",
    text: "Hard nos: neon, distressed denim, see-through fabrics",
    expect: {
      hardAvoidsIncludes: ["neon", "distress", "see"],
    },
  },
  {
    id: "honesty_no_mercy",
    step: "honesty",
    text: "Don't sugarcoat — be no mercy, tell me straight if it looks bad",
    expect: {
      honestyPreference: "no_mercy",
    },
  },
  {
    id: "honesty_gentle",
    step: "name",
    text: "Please be gentle with feedback, soft nudges only",
    expect: { honestyPreference: "gentle" },
  },
  {
    id: "brand_avoids",
    step: "name",
    text: "I love Uniqlo but I avoid Shein and Supreme",
    expect: {
      brandLikesIncludes: ["Uniqlo"],
      brandAvoidsIncludes: ["Shein", "Supreme"],
    },
  },
  {
    id: "weight_kg",
    step: "photo",
    text: "I weigh 82 kg",
    expect: { weightKgApprox: 82 },
  },
  {
    id: "weight_lb",
    step: "photo",
    text: "I'm about 175 pounds",
    expect: {
      weightKgApprox: Math.round(175 * 0.453592),
    },
  },
  {
    id: "full_mix",
    step: "name",
    text: "Hey I'm Jordan, feminine, 28 years old. I spend premium quality first, love Sézane and Reformation, hate neon and loud logos. Height 5'6, average hourglass.",
    expect: {
      preferredName: /jordan/i,
      genderPresentation: "feminine",
      ageYears: 28,
      budgetIncludes: ["premium"],
      brandLikesIncludes: ["Sézane", "Sezane", "Reformation"],
      hardAvoidsIncludes: ["neon", "logo"],
      heightCmApprox: Math.round((5 * 12 + 6) * 2.54),
      heightCmTolerance: 3,
      build: "average",
      bodyShape: "hourglass",
    },
  },
  {
    id: "chitchat_empty",
    step: "name",
    text: "hi how are you doing today lol",
    expect: { mostlyEmpty: true },
  },
  {
    id: "style_descriptors",
    step: "corner",
    text: "I love a minimal Parisian quiet luxury vibe, avoid super preppy looks",
    expect: {
      styleLikesIncludes: ["minimal", "parisian", "quiet"],
    },
  },
];

function hasApprox(
  actual: number | undefined,
  expected: number,
  tol = 2,
): boolean {
  if (actual == null) return false;
  return Math.abs(actual - expected) <= tol;
}

function listHas(
  list: string[] | undefined,
  needles: string[],
  mode: "all" | "any" = "all",
): boolean {
  if (!list?.length) return false;
  const hay = list.map((s) => s.toLowerCase());
  const checks = needles.map((n) => {
    const needle = n.toLowerCase();
    return hay.some((h) => h.includes(needle) || needle.includes(h));
  });
  return mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

function nameOk(
  actual: string | undefined,
  expected: string | RegExp,
): boolean {
  if (!actual) return false;
  if (typeof expected === "string") {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }
  return expected.test(actual);
}

type Failure = { field: string; expected: string; actual: string };

function checkCase(
  extraction: FittingTellExtraction | null,
  exp: Expectation,
): Failure[] {
  const fails: Failure[] = [];
  const fail = (field: string, expected: string, actual: unknown) => {
    fails.push({
      field,
      expected,
      actual: actual === undefined ? "∅" : JSON.stringify(actual),
    });
  };

  if (!extraction) {
    fail("extraction", "non-null", null);
    return fails;
  }

  if (exp.mostlyEmpty) {
    const substantive =
      extraction.preferredName ||
      extraction.genderPresentation ||
      extraction.styleEras?.length ||
      extraction.budgetPhilosophies?.length ||
      extraction.brandLikes?.length ||
      extraction.brandAvoids?.length ||
      extraction.hardAvoids?.length ||
      extraction.build ||
      resolveHeightCm(extraction) != null ||
      extraction.weightKg != null ||
      extraction.honestyPreference;
    if (substantive) {
      fail("mostlyEmpty", "few/no fields", extraction);
    }
    return fails;
  }

  if (exp.preferredName != null) {
    if (!nameOk(extraction.preferredName, exp.preferredName)) {
      fail("preferredName", String(exp.preferredName), extraction.preferredName);
    }
  }
  if (exp.genderPresentation) {
    if (extraction.genderPresentation !== exp.genderPresentation) {
      fail(
        "genderPresentation",
        exp.genderPresentation,
        extraction.genderPresentation,
      );
    }
  }
  if (exp.styleErasIncludes?.length) {
    if (
      !listHas(extraction.styleEras, exp.styleErasIncludes, "any")
    ) {
      fail(
        "styleEras",
        `any of ${exp.styleErasIncludes.join("|")}`,
        extraction.styleEras,
      );
    }
  }
  if (exp.ageRange) {
    if (extraction.ageRange !== exp.ageRange) {
      fail("ageRange", exp.ageRange, extraction.ageRange);
    }
  }
  if (exp.ageYears != null) {
    // accept ageYears or ageRange containing that band
    const ok =
      extraction.ageYears === exp.ageYears ||
      (exp.ageYears >= 25 &&
        exp.ageYears <= 34 &&
        (extraction.ageRange === "25-34" ||
          extraction.styleEras?.includes("23_29") ||
          extraction.styleEras?.includes("30s")));
    if (!ok) {
      fail(
        "ageYears",
        String(exp.ageYears),
        {
          ageYears: extraction.ageYears,
          ageRange: extraction.ageRange,
          styleEras: extraction.styleEras,
        },
      );
    }
  }
  if (exp.budgetIncludes?.length) {
    if (!listHas(extraction.budgetPhilosophies, exp.budgetIncludes, "any")) {
      fail(
        "budgetPhilosophies",
        `any of ${exp.budgetIncludes.join("|")}`,
        extraction.budgetPhilosophies,
      );
    }
  }
  if (exp.brandLikesIncludes?.length) {
    // unique brand slots (Sézane / Sezane count as one intent → match any alias)
    const groups = new Map<string, string[]>();
    for (const n of exp.brandLikesIncludes) {
      const key = n.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const g = groups.get(key) ?? [];
      g.push(n);
      groups.set(key, g);
    }
    const unmatched = [...groups.values()].filter(
      (aliases) => !listHas(extraction.brandLikes, aliases, "any"),
    );
    if (unmatched.length) {
      fail(
        "brandLikes",
        exp.brandLikesIncludes.join(", "),
        extraction.brandLikes,
      );
    }
  }
  if (exp.brandAvoidsIncludes?.length) {
    const missing = exp.brandAvoidsIncludes.filter(
      (n) => !listHas(extraction.brandAvoids, [n], "any"),
    );
    if (missing.length) {
      fail(
        "brandAvoids",
        exp.brandAvoidsIncludes.join(", "),
        extraction.brandAvoids,
      );
    }
  }
  if (exp.hardAvoidsIncludes?.length) {
    // any needle can match loosely for list items
    const ok = exp.hardAvoidsIncludes.every((n) =>
      listHas(extraction.hardAvoids, [n], "any"),
    );
    if (!ok) {
      fail(
        "hardAvoids",
        exp.hardAvoidsIncludes.join(", "),
        extraction.hardAvoids,
      );
    }
  }
  if (exp.styleLikesIncludes?.length) {
    const ok = exp.styleLikesIncludes.some((n) =>
      listHas(extraction.styleLikes, [n], "any"),
    );
    if (!ok) {
      fail(
        "styleLikes",
        exp.styleLikesIncludes.join("|"),
        extraction.styleLikes,
      );
    }
  }
  if (exp.honestyPreference) {
    if (extraction.honestyPreference !== exp.honestyPreference) {
      fail(
        "honestyPreference",
        exp.honestyPreference,
        extraction.honestyPreference,
      );
    }
  }
  if (exp.build) {
    if (extraction.build !== exp.build) {
      fail("build", exp.build, extraction.build);
    }
  }
  if (exp.muscularity) {
    // Soft match: "decent definition" maps to moderate|high.
    const ok =
      extraction.muscularity === exp.muscularity ||
      (exp.muscularity === "high" &&
        (extraction.muscularity === "moderate" ||
          extraction.muscularity === "high"));
    if (!ok) {
      fail("muscularity", exp.muscularity, extraction.muscularity);
    }
  }
  if (exp.bodyShape) {
    if (extraction.bodyShape !== exp.bodyShape) {
      fail("bodyShape", exp.bodyShape, extraction.bodyShape);
    }
  }
  if (exp.heightCmApprox != null) {
    const h = resolveHeightCm(extraction);
    if (
      !hasApprox(
        h,
        exp.heightCmApprox,
        exp.heightCmTolerance ?? 2,
      )
    ) {
      fail(
        "heightCm",
        `~${exp.heightCmApprox}±${exp.heightCmTolerance ?? 2}`,
        h,
      );
    }
  }
  if (exp.weightKgApprox != null) {
    if (!hasApprox(extraction.weightKg, exp.weightKgApprox, 3)) {
      fail("weightKg", `~${exp.weightKgApprox}`, extraction.weightKg);
    }
  }

  return fails;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY missing");
    process.exit(2);
  }

  console.log(`Running ${CASES.length} live fitting-tell extractions…\n`);

  let passed = 0;
  let failed = 0;
  const failures: Array<{ id: string; fails: Failure[]; raw: unknown }> = [];

  for (const c of CASES) {
    process.stdout.write(`• ${c.id}… `);
    const started = Date.now();
    let extraction: FittingTellExtraction | null = null;
    try {
      extraction = await extractFittingTell({
        text: c.text,
        known: { currentStep: c.step },
      });
    } catch (e) {
      failed += 1;
      console.log(`ERROR ${(e as Error).message} (${Date.now() - started}ms)`);
      failures.push({
        id: c.id,
        fails: [{ field: "throw", expected: "ok", actual: String(e) }],
        raw: null,
      });
      continue;
    }

    const fails = checkCase(extraction, c.expect);
    const ms = Date.now() - started;
    if (fails.length === 0) {
      passed += 1;
      console.log(`PASS (${ms}ms) — ${extraction?.summary ?? ""}`);
      // Print key extracted fields for audit trail.
      const keys = Object.entries(extraction ?? {}).filter(
        ([k, v]) => k !== "summary" && v != null && v !== "" && !(Array.isArray(v) && !v.length),
      );
      if (keys.length) {
        console.log(
          `    → ${keys.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`,
        );
      } else if (!c.expect.mostlyEmpty) {
        console.log("    → (no structured fields)");
      }
    } else {
      failed += 1;
      console.log(`FAIL (${ms}ms)`);
      for (const f of fails) {
        console.log(`    ✗ ${f.field}: expected ${f.expected}, got ${f.actual}`);
      }
      console.log(
        `    raw: ${JSON.stringify(extraction, null, 2).slice(0, 800)}`,
      );
      failures.push({ id: c.id, fails, raw: extraction });
    }
  }

  console.log("\n────────────");
  console.log(`Result: ${passed}/${CASES.length} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailed cases:");
    for (const f of failures) {
      console.log(`- ${f.id}: ${f.fails.map((x) => x.field).join(", ")}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
