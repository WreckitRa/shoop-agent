/** Dev-only QA tooling — double-locked: non-production + QA_USER_IDS allowlist. */

export function parseQaUserIds(): Set<string> {
  const raw = process.env.QA_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isQaDevEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isQaUserAllowed(userId: string): boolean {
  if (!isQaDevEnvironment()) return false;
  const allow = parseQaUserIds();
  return allow.size > 0 && allow.has(userId);
}

export function qaDevForbiddenResponse(): Response {
  return Response.json({ error: "Not found." }, { status: 404 });
}
