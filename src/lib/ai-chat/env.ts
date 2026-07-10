function stripEnv(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export function getAnthropicApiKey(): string {
  const key = stripEnv(process.env.ANTHROPIC_API_KEY);
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  return key;
}

export function getDatabaseUrl(): string {
  const url = stripEnv(process.env.DATABASE_URL);
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  return url;
}

/**
 * Voyage AI key for the Fit-scoring embeddings (Stage 3). Optional: when
 * unset, the search engine degrades Fit to deterministic attribute matching.
 */
export function getVoyageApiKey(): string | undefined {
  return stripEnv(process.env.VOYAGE_API_KEY);
}
