import { Resend } from "resend";

export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  return key;
}

export function getResendFrom(): string {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) {
    throw new Error(
      "RESEND_FROM is not configured. Use a verified domain, e.g. Shoop <noreply@shoop.world>.",
    );
  }
  return from;
}

export function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim(),
  );
}

let client: Resend | null = null;

export function getResendClient(): Resend {
  if (!client) client = new Resend(getResendApiKey());
  return client;
}
