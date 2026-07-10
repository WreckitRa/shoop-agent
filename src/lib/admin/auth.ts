import { timingSafeEqual } from "node:crypto";

export const ADMIN_TOKEN_HEADER = "x-ai-chat-admin-token";
export const ADMIN_TOKEN_STORAGE_KEY = "shoop-admin-token";

export function isAdminConfigured(): boolean {
  return Boolean(process.env.AI_CHAT_ADMIN_TOKEN?.trim());
}

export function verifyAdminToken(provided: string | null | undefined): boolean {
  const expected = process.env.AI_CHAT_ADMIN_TOKEN?.trim();
  if (!expected || !provided?.trim()) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyAdminRequest(req: Request): boolean {
  if (!isAdminConfigured()) return false;
  return verifyAdminToken(req.headers.get(ADMIN_TOKEN_HEADER));
}

export function adminUnauthorizedResponse(): Response {
  return Response.json(
    { error: "Admin access required. Set AI_CHAT_ADMIN_TOKEN and send the header." },
    { status: 403 },
  );
}

export function adminNotConfiguredResponse(): Response {
  return Response.json(
    { error: "Admin is not configured. Set AI_CHAT_ADMIN_TOKEN in the environment." },
    { status: 503 },
  );
}
