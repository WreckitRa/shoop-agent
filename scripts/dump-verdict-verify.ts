#!/usr/bin/env npx tsx
/**
 * One-shot verification dump for verdict-page questions.
 * Writes eval-verdict/samples/payload-01.json and prints stats to stdout.
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}

import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/ai-chat/db";
import { assembleVerdictInput } from "@/lib/photo-analysis/verdict-input";
import { STYLIST_READING_SCHEMA } from "@/lib/photo-analysis/verdict-prompt";

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function redact(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redact);
  if (!isRecord(obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/name|email|phone/i.test(k) && typeof v === "string") {
      out[k] = v ? "[redacted]" : v;
      continue;
    }
    out[k] = redact(v);
  }
  return out;
}

function listPresentDomains(input: {
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory: Record<string, unknown>;
  userReview: Record<string, unknown>;
  photoAnalysis: Record<string, unknown>;
}): string[] {
  const domains: string[] = [];
  const q = input.questionnaireAnswers;
  const identity = isRecord(q.identity) ? q.identity : q;
  if (identity.gender_presentation || identity.age_years || identity.style_era) {
    domains.push("identity");
  }
  const lifestyle = isRecord(q.lifestyle) ? q.lifestyle : null;
  if (lifestyle?.week_is || q.goal) domains.push("lifestyle");
  if (q.climate || q.climate_label) domains.push("climate");
  const budget = isRecord(q.budget) ? q.budget : null;
  if (budget?.philosophy) domains.push("budget");
  const taste = isRecord(q.taste) ? q.taste : null;
  if (
    taste?.style_mix ||
    taste?.honesty ||
    taste?.honest_corner ||
    Array.isArray(taste?.compliments)
  ) {
    domains.push("taste");
  }
  const body = isRecord(input.measurements.body)
    ? input.measurements.body
    : input.measurements;
  if (body.height_cm || body.weight_kg || body.body_type) domains.push("body");
  const w = input.wardrobeInventory;
  if (
    (Array.isArray(w.worn) && w.worn.length) ||
    (Array.isArray(w.wanted) && w.wanted.length) ||
    isRecord(w.honest_corner)
  ) {
    domains.push("wardrobe");
  }
  if (Array.isArray(w.comfort) && w.comfort.length) domains.push("comfort");
  if (
    (Array.isArray(w.brands_avoid) && w.brands_avoid.length) ||
    (Array.isArray(w.style_vetoes) && w.style_vetoes.length)
  ) {
    domains.push("vetoes");
  }
  const review = input.userReview;
  if (
    Array.isArray(review.confirmed_paths) ||
    Array.isArray(review.corrections)
  ) {
    domains.push("face_scan");
  } else if (input.photoAnalysis.analysis_status) {
    domains.push("face_scan");
  }
  return domains;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function matrix(labels: string[], texts: string[]) {
  const rows: Record<string, Record<string, number>> = {};
  for (let i = 0; i < labels.length; i++) {
    rows[labels[i]!] = {};
    for (let j = 0; j < labels.length; j++) {
      rows[labels[i]!]![labels[j]!] = Number(
        jaccard(texts[i] ?? "", texts[j] ?? "").toFixed(3),
      );
    }
  }
  return rows;
}

function schemaHas(key: string, node: unknown): boolean {
  const s = JSON.stringify(node);
  return s.includes(`"${key}"`);
}

function walkBasedOn(node: unknown, path: string, hits: string[]) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkBasedOn(v, `${path}[${i}]`, hits));
    return;
  }
  if (!isRecord(node)) return;
  if ("based_on" in node) hits.push(path);
  if ("analysis_basis" in node) hits.push(`${path}.analysis_basis`);
  for (const [k, v] of Object.entries(node)) walkBasedOn(v, `${path}.${k}`, hits);
}

async function main() {
  console.log("=== Q3 STYLIST_READING_SCHEMA based_on / evidence ===");
  console.log("has based_on string:", schemaHas("based_on", STYLIST_READING_SCHEMA));
  console.log(
    "has analysis_basis string:",
    schemaHas("analysis_basis", STYLIST_READING_SCHEMA),
  );
  const props = (STYLIST_READING_SCHEMA as { properties: Record<string, unknown> })
    .properties;
  for (const [k, v] of Object.entries(props)) {
    const blob = JSON.stringify(v);
    if (blob.includes("based_on") || blob.includes("analysis_basis")) {
      console.log(`  property ${k} contains evidence field`);
    }
  }

  type Row = {
    id: string;
    userId: string;
    photoHash: string;
    verdictStatus: string;
    verdictMs: number | null;
    verdictModel: string | null;
    verdictTokens: unknown;
    verdict: unknown;
    result: unknown;
    userReview: unknown;
    updatedAt: Date;
  };

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, "userId", "photoHash", "verdictStatus", "verdictMs", "verdictModel",
           "verdictTokens", verdict, result, "userReview", "updatedAt"
    FROM "PhotoAnalysis"
    WHERE verdict IS NOT NULL AND "verdictStatus" = 'done'
    ORDER BY "updatedAt" DESC
    LIMIT 20
  `;
  console.log(`\n=== stored done verdicts: ${rows.length} ===`);

  const sample = rows[0];
  if (sample) {
    const assembled = await assembleVerdictInput(sample.userId, sample.photoHash);
    const photoAnalysis = (assembled.analysis ?? {}) as Record<string, unknown>;
    const userReview = (assembled.review ?? {}) as Record<string, unknown>;
    const present_domains = listPresentDomains({
      questionnaireAnswers: assembled.questionnaireAnswers,
      measurements: assembled.measurements,
      wardrobeInventory: assembled.wardrobeInventory,
      userReview,
      photoAnalysis,
    });

    const profilePayload = {
      task: "Generate the canonical personal-stylist verdict from this reviewed profile.",
      data_manifest: { present_domains },
      photo_analysis: photoAnalysis,
      user_review: userReview,
      questionnaire_answers: assembled.questionnaireAnswers,
      measurements: assembled.measurements,
      wardrobe_inventory: assembled.wardrobeInventory,
      application_context: assembled.applicationContext,
    };

    mkdirSync("eval-verdict/samples", { recursive: true });
    writeFileSync(
      "eval-verdict/samples/payload-01.json",
      JSON.stringify(redact(profilePayload), null, 2),
    );
    console.log("wrote eval-verdict/samples/payload-01.json");
    console.log("present_domains:", present_domains.join(", ") || "(empty)");
    console.log(
      "photo_analysis roots:",
      Object.keys(photoAnalysis).sort().join(", "),
    );
    console.log(
      "photo_analysis.analysis_status.usable:",
      isRecord(photoAnalysis.analysis_status)
        ? photoAnalysis.analysis_status.usable
        : null,
    );
    const vp = isRecord(photoAnalysis.visible_profile)
      ? photoAnalysis.visible_profile
      : {};
    console.log(
      "visible_profile sections:",
      Object.keys(vp).join(", ") || "(none)",
    );
    const taste = isRecord(assembled.questionnaireAnswers.taste)
      ? assembled.questionnaireAnswers.taste
      : {};
    const lifestyle = isRecord(assembled.questionnaireAnswers.lifestyle)
      ? assembled.questionnaireAnswers.lifestyle
      : {};
    console.log("honest_corner:", JSON.stringify(taste.honest_corner ?? null));
    console.log("style_mix:", JSON.stringify(taste.style_mix ?? null));
    console.log(
      "lifestyle.weekends_are:",
      JSON.stringify(lifestyle.weekends_are ?? null),
    );
    console.log(
      "vetoes:",
      JSON.stringify(assembled.wardrobeInventory.style_vetoes ?? null),
    );
    console.log(
      "brands:",
      JSON.stringify(assembled.wardrobeInventory.brands ?? null),
    );
    console.log(
      "user_review.corrections n:",
      Array.isArray(userReview.corrections) ? userReview.corrections.length : "n/a",
    );
    const profile = await prisma.userProfile.findUnique({
      where: { userId: sample.userId },
    });
    const sizing = await prisma.sizingProfile.findUnique({
      where: { userId: sample.userId },
    });
    const brands = await prisma.brandPreference.findMany({
      where: { userId: sample.userId },
    });
    const negs = await prisma.hardNegative.findMany({
      where: { userId: sample.userId },
    });
    const blob = JSON.stringify(profilePayload);
    const missing: string[] = [];
    const checks: Array<[string, unknown]> = [
      ["UserProfile.weekendsAre", profile?.weekendsAre],
      ["UserProfile.weight via sizing.weightKg", sizing?.weightKg],
      ["UserProfile.shippingCountry", profile?.shippingCountry],
      ["UserProfile.ageRange", profile?.ageRange],
      ["UserProfile.complimentPreferences", profile?.complimentPreferences],
      ["SizingProfile.brandSizingNotes", sizing?.brandSizingNotes],
      ["BrandPreference.reasons", brands.flatMap((b) => b.reasons)],
      ["HardNegative.note", negs.map((n) => n.note).filter(Boolean)],
      ["UserProfile.pronouns", profile?.pronouns],
      ["UserProfile.decisionStyle", profile?.decisionStyle],
      ["SizingProfile.topNotes", sizing?.topNotes],
      ["confirmed_body.leg_line", isRecord(userReview.confirmed_body) ? userReview.confirmed_body.leg_line : null],
    ];
    for (const [label, val] of checks) {
      const collected =
        val != null &&
        !(Array.isArray(val) && val.length === 0) &&
        !(typeof val === "string" && !val.trim()) &&
        val !== "[]";
      const inPayload =
        collected &&
        (typeof val === "string" || typeof val === "number"
          ? blob.includes(String(val))
          : Array.isArray(val)
            ? val.some((x) => typeof x === "string" && x && blob.includes(x))
            : false);
      if (collected && !inPayload) missing.push(label);
      console.log(
        `  field ${label}: collected=${collected} inPayload=${inPayload} sample=${JSON.stringify(val)?.slice(0, 80)}`,
      );
    }
    console.log("collected-but-absent-from-payload:", missing.join("; ") || "(none on this row)");
  } else {
    console.log("NO done verdicts — skipped payload dump");
  }

  console.log("\n=== Q4 verdictMs / verdictTokens ===");
  for (const r of rows.slice(0, 3)) {
    console.log(
      `  ${r.updatedAt.toISOString()} model=${r.verdictModel} verdictMs=${r.verdictMs} tokens=${JSON.stringify(r.verdictTokens)}`,
    );
  }

  console.log("\n=== Q5 outfit_formulas last 20 ===");
  const lengths: Record<number, number> = {};
  let emptyColor0 = 0;
  let n = 0;
  const openings: string[] = [];
  const rules: string[] = [];
  const ids: string[] = [];
  let namedNear = 0;
  let emptyNear = 0;
  let issueSet = 0;
  let emptyIssue = 0;
  let wardrobeEmpty = 0;
  let wardrobeFilled = 0;
  for (const r of rows) {
    const v = isRecord(r.verdict) ? r.verdict : null;
    if (!v) continue;
    n += 1;
    const formulas = Array.isArray(v.outfit_formulas) ? v.outfit_formulas : [];
    lengths[formulas.length] = (lengths[formulas.length] ?? 0) + 1;
    const f0 = isRecord(formulas[0]) ? formulas[0] : null;
    const colors = f0 && Array.isArray(f0.color_options) ? f0.color_options : [];
    if (!colors.length || colors.every((c) => typeof c !== "string" || !c.trim())) {
      emptyColor0 += 1;
    }
    const face = isRecord(v.user_facing_verdict) ? v.user_facing_verdict : {};
    openings.push(typeof face.opening === "string" ? face.opening : "");
    const gr = Array.isArray(face.golden_rules)
      ? face.golden_rules.filter((s): s is string => typeof s === "string").join(" | ")
      : "";
    rules.push(gr);
    ids.push(r.id.slice(0, 8));
    const cs = isRecord(v.color_system) ? v.color_system : {};
    const near = Array.isArray(cs.near_face_colors) ? cs.near_face_colors : [];
    for (const raw of near) {
      const o = isRecord(raw) ? raw : {};
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name) namedNear += 1;
      else emptyNear += 1;
    }
    const careful = Array.isArray(cs.use_carefully) ? cs.use_carefully : [];
    for (const raw of careful) {
      const o = isRecord(raw) ? raw : {};
      const issue = typeof o.issue === "string" ? o.issue.trim() : "";
      if (issue) issueSet += 1;
      else emptyIssue += 1;
    }
    const plan = v.wardrobe_plan;
    if (!plan || (isRecord(plan) && Object.keys(plan).length === 0)) wardrobeEmpty += 1;
    else wardrobeFilled += 1;
  }
  console.log("count", n, "length_hist", lengths, "empty color_options[0]", emptyColor0);
  console.log("wardrobe_plan empty/{}/null", wardrobeEmpty, "filled", wardrobeFilled);
  console.log(
    "near_face named/empty",
    namedNear,
    emptyNear,
    "use_carefully.issue set/empty",
    issueSet,
    emptyIssue,
  );

  if (openings.length >= 2) {
    console.log("\n=== Q6 real-verdict opening Jaccard ===");
    console.log(JSON.stringify(matrix(ids.slice(0, 6), openings.slice(0, 6)), null, 2));
    console.log("=== Q6 real-verdict golden_rules Jaccard ===");
    console.log(JSON.stringify(matrix(ids.slice(0, 6), rules.slice(0, 6)), null, 2));
  }

  console.log("\n=== Q6 eval JSON fixtures are card-text only (no Jaccard) ===");
  console.log("run `npm run eval:verdict -- --generate` for Prisma-seeded similarity");

  console.log("\n=== Q10 tryon_generations outfit (fitting-room look ids) ===");
  const gens = await prisma.tryonGeneration.findMany({
    where: { kind: "outfit" },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      status: true,
      ms: true,
      lookId: true,
      createdAt: true,
      error: true,
    },
  });
  const fr = gens.filter((g) => (g.lookId ?? "").startsWith("fitting-room:"));
  const byStatus: Record<string, number> = {};
  const times: number[] = [];
  for (const g of fr) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
    if (g.status === "completed" && typeof g.ms === "number") times.push(g.ms);
  }
  times.sort((a, b) => a - b);
  const p50 = times.length ? times[Math.floor(times.length / 2)] : null;
  const completed = byStatus.completed ?? 0;
  const failed = (byStatus.failed ?? 0) + (byStatus.pending ?? 0) + (byStatus.processing ?? 0);
  const total = fr.length;
  console.log(
    JSON.stringify({
      n: total,
      byStatus,
      successRate: total ? completed / total : null,
      p50_ms: p50,
      wouldShowCouldntDress: total ? (total - completed) / total : null,
    }),
  );

  const events = await prisma.productEvent.findMany({
    where: { name: { in: ["twin_render_completed", "twin_render_failed"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { name: true, props: true, createdAt: true },
  });
  const reading = events.filter((e) => {
    const p = isRecord(e.props) ? e.props : {};
    return p.source === "reading_look";
  });
  console.log(
    "product_events twin_render last100",
    events.length,
    "reading_look",
    reading.length,
    "completed",
    events.filter((e) => e.name === "twin_render_completed").length,
    "failed",
    events.filter((e) => e.name === "twin_render_failed").length,
  );

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
