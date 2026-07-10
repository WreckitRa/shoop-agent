import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";

/** Server-side Supabase client for fashion memory tables (bypasses RLS — caller must enforce user_id). */
export function fashionMemoryDb() {
  return getSupabaseAdminClient() as any;
}

export class FashionMemoryError extends Error {
  readonly name = "FashionMemoryError";
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function assertFashionRow<T>(
  label: string,
  data: T | null,
  error?: unknown,
): T {
  if (data) return data;
  const detail =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : undefined;
  throw new FashionMemoryError(
    detail ? `${label}: ${detail}` : `${label} failed`,
  );
}
