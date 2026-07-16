/**
 * Seed the three manual-QA accounts from qa-journey.md into Supabase Auth,
 * then store their user IDs in `.env` (QA_USER_IDS) and `qa-accounts.local.json`.
 *
 * Usage:
 *   npm run qa:seed-accounts
 *   npx tsx scripts/seed-qa-accounts.ts --password 'YourSharedPassword1'
 *
 * Idempotent: re-running finds existing emails and refreshes stored IDs.
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (from .env).
 *
 * Uses the Auth Admin REST API (no realtime/WebSocket) so it runs on Node 20.
 * Not a SQL migration — auth.users is owned by Supabase Auth, not Prisma.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const OUT_JSON = path.join(ROOT, "qa-accounts.local.json");

const DEFAULT_PASSWORD = "ShoopQaRound1!";

type QaAccountDef = {
  role: "ACCT-COLD" | "ACCT-SELF" | "ACCT-FAMILY";
  email: string;
  preferredName: string;
  note: string;
};

const ACCOUNTS: QaAccountDef[] = [
  {
    role: "ACCT-COLD",
    email: "qa-cold@shoop.local",
    preferredName: "QA Cold",
    note: "Resettable cold-start account — wipe before every Block 1 / 2.7 run",
  },
  {
    role: "ACCT-SELF",
    email: "qa-self@shoop.local",
    preferredName: "QA Self",
    note: "Persistent self account — never reset; memory / budget / aging",
  },
  {
    role: "ACCT-FAMILY",
    email: "qa-family@shoop.local",
    preferredName: "QA Family",
    note: "Multi-person cast (Gabriel, Joe, Rima, kid) — rarely reset",
  },
];

type AuthUser = {
  id: string;
  email?: string | null;
};

function loadDotEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  let password = DEFAULT_PASSWORD;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--password" && argv[i + 1]) {
      password = argv[++i]!;
    }
  }
  return { password };
}

function upsertEnvVar(filePath: string, key: string, value: string): void {
  const block = `${key}=${value}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${block}\n`, "utf8");
    return;
  }
  const text = readFileSync(filePath, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    writeFileSync(filePath, text.replace(re, block), "utf8");
    return;
  }
  const suffix = text.endsWith("\n") ? "" : "\n";
  writeFileSync(
    filePath,
    `${text}${suffix}\n# Manual QA accounts (seed-qa-accounts.ts)\n${block}\n`,
    "utf8",
  );
}

function authHeaders(secret: string): HeadersInit {
  return {
    Authorization: `Bearer ${secret}`,
    apikey: secret,
    "Content-Type": "application/json",
  };
}

async function listUsersPage(
  baseUrl: string,
  secret: string,
  page: number,
): Promise<AuthUser[]> {
  const url = new URL(`${baseUrl}/auth/v1/admin/users`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "200");
  const res = await fetch(url, { headers: authHeaders(secret) });
  if (!res.ok) {
    throw new Error(`listUsers failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { users?: AuthUser[] };
  return body.users ?? [];
}

async function findUserIdByEmail(
  baseUrl: string,
  secret: string,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const users = await listUsersPage(baseUrl, secret, page);
    const hit = users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

async function createUser(
  baseUrl: string,
  secret: string,
  account: QaAccountDef,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders(secret),
    body: JSON.stringify({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: {
        preferred_name: account.preferredName,
        qa_role: account.role,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `createUser ${account.email} failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as AuthUser;
  if (!body.id) throw new Error(`createUser returned no id for ${account.email}`);
  return body.id;
}

async function updateUser(
  baseUrl: string,
  secret: string,
  userId: string,
  account: QaAccountDef,
  password: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: authHeaders(secret),
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: {
        preferred_name: account.preferredName,
        qa_role: account.role,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `updateUser ${account.email} failed (${res.status}): ${await res.text()}`,
    );
  }
}

async function ensureUser(
  baseUrl: string,
  secret: string,
  account: QaAccountDef,
  password: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findUserIdByEmail(baseUrl, secret, account.email);
  if (existing) {
    await updateUser(baseUrl, secret, existing, account, password);
    return { id: existing, created: false };
  }
  const id = await createUser(baseUrl, secret, account, password);
  return { id, created: true };
}

async function main() {
  loadDotEnvFile(ENV_PATH);

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !secret) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (load from .env).",
    );
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production") {
    console.error("Refused: do not seed QA accounts against production.");
    process.exit(1);
  }

  const baseUrl = rawUrl.replace(/\/$/, "");
  const { password } = parseArgs(process.argv.slice(2));

  const seeded: Array<{
    role: QaAccountDef["role"];
    email: string;
    userId: string;
    created: boolean;
    note: string;
  }> = [];

  for (const account of ACCOUNTS) {
    const { id, created } = await ensureUser(
      baseUrl,
      secret,
      account,
      password,
    );
    seeded.push({
      role: account.role,
      email: account.email,
      userId: id,
      created,
      note: account.note,
    });
    console.log(
      `${created ? "created" : "exists "}  ${account.role.padEnd(12)} ${account.email} → ${id}`,
    );
  }

  const ids = seeded.map((s) => s.userId).join(",");
  upsertEnvVar(ENV_PATH, "QA_USER_IDS", ids);

  const payload = {
    generatedAt: new Date().toISOString(),
    password,
    qaUserIds: ids,
    accounts: seeded.map((s) => ({
      role: s.role,
      email: s.email,
      userId: s.userId,
      password,
      note: s.note,
    })),
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log("\nStored:");
  console.log(`  QA_USER_IDS in ${ENV_PATH}`);
  console.log(`  credentials  → ${OUT_JSON}`);
  console.log("\nSign-in password (all three):", password);
  console.log("\nNext: npm run qa:isolation -- --users", ids);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
