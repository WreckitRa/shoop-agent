/**
 * Voyage AI embeddings client for the Fit signal (Stage 3).
 *
 * Used to embed pooled candidate text + the buyer's (or recipient's) taste
 * vector so we can rank by cosine similarity. The whole call runs under a soft
 * deadline; if Voyage is slow or `VOYAGE_API_KEY` is unset, Fit degrades to
 * attribute-match only (the engine never blocks on embeddings).
 */
import { getVoyageApiKey } from "../env";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** Default embedding model. Override via VOYAGE_MODEL. */
export const VOYAGE_MODEL = process.env.VOYAGE_MODEL?.trim() || "voyage-3";

/** Soft deadline for the batch embed call (Stage 3 budget). */
export const VOYAGE_SOFT_DEADLINE_MS = (() => {
  const n = Number(process.env.VOYAGE_TIMEOUT_MS ?? "1200");
  if (!Number.isFinite(n) || n < 200) return 1200;
  return Math.min(Math.round(n), 5000);
})();

export type VoyageInputType = "query" | "document";

type VoyageResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  model?: string;
};

export function isVoyageConfigured(): boolean {
  return Boolean(getVoyageApiKey());
}

/**
 * Embed a batch of texts. Returns `null` (degrade) when unconfigured, on
 * timeout, or on any error. Vectors are returned in input order.
 */
export async function embedTexts(
  texts: string[],
  inputType: VoyageInputType = "document",
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<number[][] | null> {
  const apiKey = getVoyageApiKey();
  if (!apiKey || !texts.length) return null;

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? VOYAGE_SOFT_DEADLINE_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: VOYAGE_MODEL,
        input_type: inputType,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as VoyageResponse;
    const rows = json.data;
    if (!Array.isArray(rows) || !rows.length) return null;
    // Re-order defensively by `index` so vectors align with `texts`.
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const idx = typeof row.index === "number" ? row.index : i;
      if (Array.isArray(row.embedding)) out[idx] = row.embedding;
    }
    return out.every((v) => Array.isArray(v)) ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cosine similarity in [-1, 1]; 0 when either vector is empty/mismatched. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
