/**
 * CI: live fashion prompt constants must hash-match docs/fashion/*.md bodies.
 * Definition of done for prompt CRs: code + doc in the same PR.
 *
 * Usage: npx tsx scripts/check-fashion-prompt-docs.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

type Spec = {
  doc: string;
  source: string;
  extract: (source: string) => string;
};

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function extractBetween(source: string, startRe: RegExp, endMarker: string): string {
  const m = startRe.exec(source);
  if (!m || m.index == null) {
    throw new Error(`start pattern not found: ${startRe}`);
  }
  const from = m.index + m[0].length;
  const rest = source.slice(from);
  const end = rest.indexOf(endMarker);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return rest.slice(0, end);
}

function extractDocFence(docPath: string): string {
  const text = readFileSync(docPath, "utf8");
  const m = text.match(/## Verbatim prompt\n\n```\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`verbatim fence missing in ${docPath}`);
  return m[1]!;
}

const SPECS: Spec[] = [
  {
    doc: "docs/fashion/router.md",
    source: "src/lib/fashion-memory/router/prompt.ts",
    extract: (s) => {
      const staticBody = extractBetween(
        s,
        /export const ROUTER_PROMPT_STATIC = `/,
        "`;\n\n/** Full router prompt template",
      );
      return `${staticBody}

--- CONTEXT ---
{ROSTER}

{PROFILES}

CURRENT DATE: {DATE}`;
    },
  },
  {
    doc: "docs/fashion/planner.md",
    source: "src/lib/fashion-memory/search-planner/prompt.ts",
    extract: (s) =>
      extractBetween(s, /const SEARCH_PLANNER_PROMPT = `/, "`;\n\nexport"),
  },
  {
    doc: "docs/fashion/extraction.md",
    source: "src/lib/fashion-memory/extraction/prompt.ts",
    extract: (s) => extractBetween(s, /return `/, "`;\n}"),
  },
  {
    doc: "docs/fashion/curation.md",
    source: "src/lib/fashion-memory/curation/prompt.ts",
    extract: (s) => {
      const skel = extractBetween(
        s,
        /export const CURATION_PROMPT_SKELETON = `/,
        "`;\n\nexport const MODE_SECTION",
      );
      const single = extractBetween(
        s,
        /export const MODE_SECTION_SINGLE_ITEM = `/,
        "`;\n\nexport const MODE_SECTION_OUTFIT",
      );
      const outfit = extractBetween(
        s,
        /export const MODE_SECTION_OUTFIT = `/,
        "`;\n\nexport const MODE_SECTION_CAPSULE",
      );
      const capsule = extractBetween(
        s,
        /export const MODE_SECTION_CAPSULE = `/,
        "`;\n\nexport function",
      );
      return (
        skel +
        "\n\n--- MODE SECTIONS ---\n\n### MODE_SECTION_SINGLE_ITEM\n\n" +
        single +
        "\n\n### MODE_SECTION_OUTFIT\n\n" +
        outfit +
        "\n\n### MODE_SECTION_CAPSULE\n\n" +
        capsule
      );
    },
  },
  {
    doc: "docs/fashion/brand_translate.md",
    source: "src/lib/fashion-memory/brand/prompt.ts",
    extract: (s) => extractBetween(s, /return `/, "`;\n}"),
  },
  {
    doc: "docs/fashion/normalize_classify.md",
    source: "src/lib/fashion-memory/normalize/llm-classify.ts",
    extract: (s) =>
      extractBetween(s, /const CLASSIFY_LABELS_SYSTEM_PROMPT = `/, "`;\n\nexport"),
  },
];

let failed = 0;
for (const spec of SPECS) {
  const sourceText = readFileSync(join(ROOT, spec.source), "utf8");
  const live = spec.extract(sourceText);
  const docBody = extractDocFence(join(ROOT, spec.doc));
  const liveHash = sha(live);
  const docHash = sha(docBody);
  if (liveHash !== docHash) {
    failed += 1;
    console.error(`❌ ${spec.doc}`);
    console.error(`   live ${liveHash.slice(0, 16)}… (${live.length} chars)`);
    console.error(`   doc  ${docHash.slice(0, 16)}… (${docBody.length} chars)`);
    console.error(`   source: ${spec.source}`);
  } else {
    console.log(`✅ ${spec.doc} (${liveHash.slice(0, 12)}…)`);
  }
}

if (failed) {
  console.error(
    `\n${failed} prompt doc(s) out of sync. Update docs/fashion/ in the same PR.`,
  );
  process.exit(1);
}
console.log("\nAll fashion prompt docs match live sources.");
