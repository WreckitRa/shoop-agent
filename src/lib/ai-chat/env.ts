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
