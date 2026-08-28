import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tracedLLMCall } from "@/lib/fashion-memory/observability/traced-llm-call";
import { FASHION_ROUTER_MODEL } from "@/lib/fashion-memory/models";
import {
  personaSchema,
  withPersonaId,
  type Patience,
  type Persona,
  type PersonaEdge,
  type ProfileState,
  type Volunteers,
} from "./persona";

const REQUEST_TYPES = [
  "single_item",
  "outfit",
  "capsule",
  "multi_item",
] as const;
const PROFILE_STATES: ProfileState[] = [
  "new",
  "known_relevant",
  "known_irrelevant",
  "quick_shopper",
  "has_depth_default",
  "has_pick_history",
];
const PATIENCES: Patience[] = ["quick", "normal", "guided"];
const SPECIFICITIES = ["vague", "partial", "complete"] as const;
const EDGES: Array<PersonaEdge | undefined> = [
  undefined,
  "speed_signal_turn2",
  "dodges_size",
  "refines_after_results",
  "mentions_new_person",
  "typos",
  "changes_mind",
];

type StructuralCell = {
  request_type: (typeof REQUEST_TYPES)[number];
  specificity: (typeof SPECIFICITIES)[number];
  profile_state: ProfileState;
  patience: Patience;
  language: "en" | "fr" | "ar";
  edge?: PersonaEdge;
  volunteers: Volunteers;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickLanguage(
  rand: () => number,
  allowed: ReadonlyArray<"en" | "fr" | "ar"> = ["en"],
): "en" | "fr" | "ar" {
  // Default English-only until the router clears the exit bar.
  // `generatePersonas({ languages: ["fr","ar"] })` / `--languages fr,ar` re-enables.
  if (!allowed.length) return "en";
  if (allowed.length === 1) return allowed[0]!;
  return allowed[Math.floor(rand() * allowed.length)]!;
}

function volunteersFor(specificity: (typeof SPECIFICITIES)[number]): Volunteers {
  if (specificity === "complete") return "everything";
  if (specificity === "partial") return "some";
  return "little";
}

/** Stratified sample: every request_type × profile_state at least twice. */
export function sampleStructuralCells(
  seed: number,
  count = 60,
  languages: ReadonlyArray<"en" | "fr" | "ar"> = ["en"],
): StructuralCell[] {
  const rand = mulberry32(seed);
  const allowed = languages.length ? languages : (["en"] as const);
  const required: StructuralCell[] = [];
  for (const request_type of REQUEST_TYPES) {
    for (const profile_state of PROFILE_STATES) {
      for (let i = 0; i < 2; i++) {
        const specificity = SPECIFICITIES[Math.floor(rand() * 3)]!;
        required.push({
          request_type,
          specificity,
          profile_state,
          patience: PATIENCES[Math.floor(rand() * 3)]!,
          language: pickLanguage(rand, allowed),
          edge: EDGES[Math.floor(rand() * EDGES.length)],
          volunteers: volunteersFor(specificity),
        });
      }
    }
  }
  // 4×6×2 = 48; pad to 60
  while (required.length < count) {
    required.push({
      request_type: REQUEST_TYPES[Math.floor(rand() * 4)]!,
      specificity: SPECIFICITIES[Math.floor(rand() * 3)]!,
      profile_state: PROFILE_STATES[Math.floor(rand() * 6)]!,
      patience: PATIENCES[Math.floor(rand() * 3)]!,
      language: pickLanguage(rand, allowed),
      edge: EDGES[Math.floor(rand() * EDGES.length)],
      volunteers: volunteersFor(SPECIFICITIES[Math.floor(rand() * 3)]!),
    });
  }
  // Shuffle with same seed stream
  for (let i = required.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [required[i], required[j]] = [required[j]!, required[i]!];
  }
  return required.slice(0, count);
}

const GARMENT_BANK: Record<string, string[][]> = {
  single_item: [["blazer"], ["dress"], ["sneakers"], ["sweater"], ["jeans"]],
  outfit: [
    ["shirt", "trousers", "blazer", "shoes"],
    ["blouse", "trousers", "blazer"],
    ["polo", "chinos", "loafers"],
  ],
  capsule: [
    ["dress", "sandals", "light jacket"],
    ["shirts", "trousers", "sneakers", "overshirt"],
  ],
  multi_item: [
    ["coat", "boots"],
    ["jeans", "t-shirt"],
    ["skirt", "blouse"],
  ],
};

const OCCASIONS = [
  "baptism with family",
  "client meeting",
  "weekend brunch",
  "wedding guest",
  "job interview",
  "week by the sea",
  "winter commute",
  "date night",
  "office Friday",
];

function templatePersona(cell: StructuralCell, idx: number, rand: () => number): Persona {
  const garments =
    GARMENT_BANK[cell.request_type]![
      Math.floor(rand() * GARMENT_BANK[cell.request_type]!.length)
    ]!;
  const occasion = OCCASIONS[Math.floor(rand() * OCCASIONS.length)]!;
  const names = {
    en: ["Alex", "Jordan", "Sam", "Riley", "Casey", "Morgan"],
    fr: ["Léa", "Hugo", "Inès", "Louis", "Chloé", "Noah"],
    ar: ["Noor", "Yusuf", "Hana", "Karim", "Sara", "Amir"],
  };
  const name = names[cell.language][Math.floor(rand() * 6)]!;

  const dept =
    cell.profile_state === "new"
      ? rand() > 0.5
        ? ("mens" as const)
        : ("womens" as const)
      : rand() > 0.45
        ? ("mens" as const)
        : ("womens" as const);

  const sizes: Record<string, string> | undefined =
    cell.profile_state === "new"
      ? undefined
      : dept === "mens"
        ? { tops: "L", bottoms: "34", shoes: "10" }
        : { tops: "S", bottoms: "27", shoes: "38", dresses: "4" };

  const needsAnchor = (
    [
      "known_relevant",
      "quick_shopper",
      "has_pick_history",
    ] as ProfileState[]
  ).includes(cell.profile_state);

  let opening: string;
  if (cell.specificity === "vague") {
    opening =
      cell.language === "fr"
        ? "j'ai besoin de quelque chose pour bientôt"
        : cell.language === "ar"
          ? "محتاج شي لمناسبة قريبة"
          : "need something for soon";
  } else if (cell.specificity === "partial") {
    opening =
      cell.language === "fr"
        ? `besoin d'aide pour ${occasion}`
        : cell.language === "ar"
          ? `محتاج مساعدة لـ ${occasion}`
          : `need help for ${occasion}`;
  } else {
    opening =
      cell.language === "fr"
        ? `je cherche ${garments.join(", ")} pour ${occasion}, taille ${sizes?.tops ?? "M"}`
        : cell.language === "ar"
          ? `أبحث عن ${garments.join(" و")} لـ ${occasion}`
          : `looking for ${garments.join(" + ")} for ${occasion}, size ${sizes?.tops ?? "M"}, show me 2`;
  }
  if (cell.edge === "typos") {
    opening = opening
      .replace(/looking/g, "lookng")
      .replace(/something/g, "somthing")
      .replace(/need /g, "ned ");
  }

  const profile: Persona["profile"] = {
    state: cell.profile_state,
    department: dept,
    sizes,
  };
  if (
    cell.profile_state === "known_relevant" ||
    cell.profile_state === "quick_shopper" ||
    cell.profile_state === "has_pick_history"
  ) {
    profile.signals = ["+navy [work, stated]", "+tailored [work, stated]"];
    profile.recent_picks = ["navy blazer", "white shirt"];
    profile.shopping_style =
      cell.profile_state === "quick_shopper" ? "quick" : "guided";
  }
  if (cell.profile_state === "known_irrelevant") {
    profile.signals = ["+neon [festival, stated]", "+boardshorts [beach, stated]"];
    profile.recent_picks = ["floral swim short"];
  }
  if (cell.profile_state === "has_depth_default") {
    profile.depth_default = { count: 3, unit: "looks" };
  }
  if (cell.profile_state === "quick_shopper") {
    profile.shopping_style = "quick";
  }

  return withPersonaId({
    name: `${name}${idx}`,
    language: cell.language,
    patience: cell.patience,
    volunteers: cell.volunteers,
    specificity: cell.specificity,
    edge: cell.edge,
    profile,
    truth: {
      request_type: cell.request_type,
      garments,
      owns: cell.volunteers === "everything" ? [] : garments.length > 2 ? [garments[garments.length - 1]!] : [],
      occasion,
      formality: occasion.includes("baptism") || occasion.includes("interview")
        ? "dressy"
        : "smart casual",
      color: needsAnchor ? "navy" : rand() > 0.5 ? "navy" : "surprise",
      budget:
        cell.specificity === "complete"
          ? { max: 120, currency: "USD", scope: "per_item" }
          : "no_cap",
      depth: (() => {
        // truth.depth must equal any count stated in opening_message.
        const openingCount = opening.match(
          /\b(?:show me|pull)\s+(\d+)\b|\b(\d+)\s*(?:looks?|options?)\b/i,
        );
        const n = openingCount
          ? Number(openingCount[1] || openingCount[2])
          : null;
        if (n != null && Number.isFinite(n) && n >= 1 && n <= 8) {
          return cell.request_type === "single_item"
            ? { options: n }
            : { looks: n };
        }
        if (cell.specificity === "complete") {
          return cell.request_type === "single_item"
            ? { options: 3 }
            : { looks: 2 };
        }
        if (cell.profile_state === "has_depth_default") return "you_decide" as const;
        return { looks: 2 };
      })(),
      anchor: needsAnchor
        ? (["keep", "push", "explore"] as const)[Math.floor(rand() * 3)]!
        : "n/a",
    },
    opening_message: opening,
  });
}

function openingViolatesVolunteers(p: Persona): boolean {
  const msg = p.opening_message.toLowerCase();
  if (p.volunteers === "everything") return false;
  const budgetLeak = /\$|\beur\b|\beuro|\bbudget\b|\bunder\b\s*\d/.test(msg);
  const sizeLeak = /\bsize\b|\btaille\b|\bمقاس\b|\b[xls]{1,3}\b|\b\d{2}\b/.test(
    msg,
  );
  const countLeak = /\b\d+\s*(looks?|options?|pieces?)\b/.test(msg);
  if (p.volunteers === "little") {
    if (budgetLeak || sizeLeak || countLeak) return true;
    // vague: garment at most — reject if occasion-like words AND garment both for vague
    if (p.specificity === "vague") {
      const hasOccasion =
        /tomorrow|meeting|wedding|baptism|interview|weekend|week |soir|mariage|زفاف/.test(
          msg,
        );
      const hasGarment =
        /shirt|dress|blazer|shoe|tee|jean|coat|sweater|chemise|robe|حذاء/.test(
          msg,
        );
      if (hasOccasion && hasGarment) return true;
    }
  }
  if (p.volunteers === "some" && budgetLeak && sizeLeak && countLeak) return true;
  return false;
}

async function polishWithLlm(
  cell: StructuralCell,
  draft: Persona,
  traceId: string,
): Promise<Persona | null> {
  const system = `You fill realistic shopper persona fields for an eval.
Return ONLY JSON matching this shape:
{"name":string,"opening_message":string,"truth":{"garments":string[],"owns":string[],"occasion":string,"formality"?:string,"color"?:string}}
Rules:
- opening_message in language=${cell.language}, natural chat typing
- specificity=${cell.specificity}: vague→almost no detail; partial→occasion (+ maybe garment); complete→garment+occasion+size/budget/count ok
- volunteers=${cell.volunteers}: do not over-volunteer in opening_message
- request_type=${cell.request_type}; keep garments coherent
- Do not invent sizes in opening unless volunteers=everything or specificity=complete`;

  const msg = await tracedLLMCall({
    traceId,
    stage: "eval_persona_gen",
    model: FASHION_ROUTER_MODEL,
    systemPrompt: system,
    disablePromptCache: true,
    maxTokens: 600,
    inputMessages: [
      {
        role: "user",
        content: JSON.stringify({
          cell,
          draft_truth: draft.truth,
          draft_opening: draft.opening_message,
        }),
      },
    ],
  });
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      name?: string;
      opening_message?: string;
      truth?: Partial<Persona["truth"]>;
    };
    const next = withPersonaId({
      ...draft,
      name: parsed.name?.trim() || draft.name,
      opening_message: parsed.opening_message?.trim() || draft.opening_message,
      truth: {
        ...draft.truth,
        garments: parsed.truth?.garments?.length
          ? parsed.truth.garments
          : draft.truth.garments,
        owns: parsed.truth?.owns ?? draft.truth.owns,
        occasion: parsed.truth?.occasion ?? draft.truth.occasion,
        formality: parsed.truth?.formality ?? draft.truth.formality,
        color: parsed.truth?.color ?? draft.truth.color,
      },
    });
    if (openingViolatesVolunteers(next)) return null;
    return personaSchema.parse(next);
  } catch {
    return null;
  }
}

export async function loadGoldenPersonas(
  root = path.join(process.cwd(), "src/lib/fashion-memory/eval/personas"),
): Promise<Persona[]> {
  const raw = await readFile(path.join(root, "golden-seed.json"), "utf8");
  const arr = JSON.parse(raw) as unknown[];
  return arr.map((p) => personaSchema.parse(p));
}

export async function loadKnownClientPersonas(
  root = path.join(process.cwd(), "src/lib/fashion-memory/eval/personas"),
): Promise<Persona[]> {
  const raw = await readFile(path.join(root, "known-client.json"), "utf8");
  const arr = JSON.parse(raw) as unknown[];
  return arr.map((p) => personaSchema.parse(p));
}

export async function generatePersonas(opts: {
  seed: number;
  count?: number;
  useLlm?: boolean;
  outDir?: string;
  /** Default English-only. Pass ["fr","ar"] (or with en) for multilingual seeds later. */
  languages?: Array<"en" | "fr" | "ar">;
}): Promise<{ personas: Persona[]; path: string }> {
  const count = opts.count ?? 60;
  const cells = sampleStructuralCells(
    opts.seed,
    count,
    opts.languages?.length ? opts.languages : ["en"],
  );
  const rand = mulberry32(opts.seed ^ 0x9e3779b9);
  const personas: Persona[] = [];
  const traceId = randomUUID();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    let p = templatePersona(cell, i, rand);
    if (opts.useLlm === true && process.env.ANTHROPIC_API_KEY?.trim()) {
      const polished = await polishWithLlm(cell, p, traceId);
      if (polished) p = polished;
    }
    if (openingViolatesVolunteers(p)) {
      // Fall back to safer vague/partial opening
      p = withPersonaId({
        ...p,
        opening_message:
          p.language === "fr"
            ? "salut, je cherche une idée"
            : p.language === "ar"
              ? "مرحبا، أحتاج مساعدة"
              : "hey — need a hand finding something",
        volunteers: "little",
        specificity: "vague",
      });
    }
    personas.push(p);
  }

  const outDir =
    opts.outDir ??
    path.join(process.cwd(), "src/lib/fashion-memory/eval/personas");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${opts.seed}.json`);
  await writeFile(outPath, `${JSON.stringify(personas, null, 2)}\n`, "utf8");
  return { personas, path: outPath };
}

export async function loadOrGeneratePersonas(opts: {
  seed: number;
  useLlm?: boolean;
}): Promise<Persona[]> {
  const file = path.join(
    process.cwd(),
    "src/lib/fashion-memory/eval/personas",
    `${opts.seed}.json`,
  );
  try {
    const raw = await readFile(file, "utf8");
    return (JSON.parse(raw) as unknown[]).map((p) => personaSchema.parse(p));
  } catch {
    const gen = await generatePersonas(opts);
    return gen.personas;
  }
}

export function stableRunId(seed: number, label?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return label ? `${seed}-${label}-${ts}` : `${seed}-${ts}`;
}

export function hashPersonas(personas: Persona[]): string {
  return createHash("sha256")
    .update(JSON.stringify(personas.map((p) => p.id)))
    .digest("hex")
    .slice(0, 12);
}
