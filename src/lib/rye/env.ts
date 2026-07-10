export function isRyeConfigured(): boolean {
  return Boolean(process.env.RYE_API_KEY?.trim());
}

export function getRyeApiKey(): string {
  const key = process.env.RYE_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing required environment variable: RYE_API_KEY");
  }
  return key;
}

export function getRyeEnvironment(): "production" | "staging" {
  const raw = process.env.RYE_ENVIRONMENT?.trim().toLowerCase();
  return raw === "production" ? "production" : "staging";
}

/** Rye's Stripe publishable key — must be used for card tokenization, not your own. */
export function getRyeStripePublishableKey(): string {
  const env = getRyeEnvironment();
  const key =
    env === "production"
      ? process.env.NEXT_PUBLIC_RYE_STRIPE_PUBLISHABLE_KEY_PRODUCTION
      : process.env.NEXT_PUBLIC_RYE_STRIPE_PUBLISHABLE_KEY_STAGING;
  if (!key?.trim()) {
    throw new Error(
      `Missing Rye Stripe publishable key for ${env} (NEXT_PUBLIC_RYE_STRIPE_PUBLISHABLE_KEY_${env.toUpperCase()}).`,
    );
  }
  return key.trim();
}
