/**
 * QA reset — wipe per-user fashion + chat state for a clean manual QA session.
 *
 * Usage:
 *   npx tsx scripts/qa-reset.ts --user <user_id> [--keep-traces]
 */
import { PrismaClient } from "@prisma/client";
import { isQaUserAllowed } from "../src/lib/qa/guard";
import { qaResetUser } from "../src/lib/qa/reset-user";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  let userId: string | null = null;
  let keepTraces = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--user" && argv[i + 1]) {
      userId = argv[++i]!;
    } else if (arg === "--keep-traces") {
      keepTraces = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npx tsx scripts/qa-reset.ts --user <user_id> [--keep-traces]`);
      process.exit(0);
    }
  }
  return { userId, keepTraces };
}

async function main() {
  const { userId, keepTraces } = parseArgs(process.argv.slice(2));
  if (!userId) {
    console.error("Missing --user <user_id>");
    process.exit(1);
  }

  if (!isQaUserAllowed(userId)) {
    console.error(
      "Refused: NODE_ENV must not be production and user_id must be in QA_USER_IDS.",
    );
    process.exit(1);
  }

  const { summary, preserved } = await qaResetUser({ userId, keepTraces });

  console.log(`QA reset for user ${userId}${keepTraces ? " (traces preserved)" : ""}`);
  console.log("\nRows deleted:");
  for (const [table, count] of Object.entries(summary).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${table}: ${count}`);
  }
  console.log("\nPreserved global tables (not touched):");
  for (const table of preserved) {
    console.log(`  ${table}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
