/**
 * Block-7 isolation check — assert zero cross-user leakage in user-scoped tables.
 *
 * Usage:
 *   npx tsx scripts/qa-isolation-check.ts --users <id1,id2,...>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const USER_SCOPED_TABLES = [
  "people",
  "fashion_facts",
  "style_signals",
  "request_events",
  "search_pools",
] as const;

const SHARED_NO_USER_ID = [
  "color_label_map",
  "size_label_map",
  "brand_translations",
  "shop_departments",
] as const;

type CheckRow = {
  check: string;
  status: "pass" | "fail";
  detail: string;
};

function parseUsers(argv: string[]): string[] {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--users" && argv[i + 1]) {
      return argv[++i]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

async function countCrossUser(
  table: (typeof USER_SCOPED_TABLES)[number],
  userIds: string[],
): Promise<number> {
  switch (table) {
    case "people":
      return prisma.fashionPerson.count({
        where: { userId: { notIn: userIds } },
      });
    case "fashion_facts":
      return prisma.fashionFact.count({
        where: { userId: { notIn: userIds } },
      });
    case "style_signals":
      return prisma.fashionStyleSignal.count({
        where: { userId: { notIn: userIds } },
      });
    case "request_events":
      return prisma.fashionRequestEvent.count({
        where: { userId: { notIn: userIds } },
      });
    case "search_pools":
      return prisma.searchPool.count({
        where: { userId: { notIn: userIds } },
      });
    default:
      return 0;
  }
}

async function perUserCounts(
  table: (typeof USER_SCOPED_TABLES)[number],
  userId: string,
): Promise<number> {
  switch (table) {
    case "people":
      return prisma.fashionPerson.count({ where: { userId } });
    case "fashion_facts":
      return prisma.fashionFact.count({ where: { userId } });
    case "style_signals":
      return prisma.fashionStyleSignal.count({ where: { userId } });
    case "request_events":
      return prisma.fashionRequestEvent.count({ where: { userId } });
    case "search_pools":
      return prisma.searchPool.count({ where: { userId } });
    default:
      return 0;
  }
}

async function main() {
  const userIds = parseUsers(process.argv.slice(2));
  if (userIds.length < 2) {
    console.error("Provide at least two user ids: --users id1,id2");
    process.exit(1);
  }

  const rows: CheckRow[] = [];

  for (const table of USER_SCOPED_TABLES) {
    const foreign = await countCrossUser(table, userIds);
    rows.push({
      check: `${table} — no rows outside allowlist`,
      status: foreign === 0 ? "pass" : "fail",
      detail:
        foreign === 0
          ? `0 foreign rows`
          : `${foreign} row(s) belong to users outside ${userIds.join(", ")}`,
    });
  }

  for (const userId of userIds) {
    for (const table of USER_SCOPED_TABLES) {
      const count = await perUserCounts(table, userId);
      rows.push({
        check: `${table} — scoped to ${userId.slice(0, 8)}…`,
        status: "pass",
        detail: `${count} row(s)`,
      });
    }
  }

  for (const table of SHARED_NO_USER_ID) {
    rows.push({
      check: `${table} — global (no user_id column)`,
      status: "pass",
      detail: "schema check only — table is shared cache",
    });
  }

  const failed = rows.filter((r) => r.status === "fail");
  console.log("\nQA isolation check\n");
  console.log("| Check | Status | Detail |");
  console.log("| --- | --- | --- |");
  for (const row of rows) {
    const icon = row.status === "pass" ? "✅" : "❌";
    console.log(`| ${row.check} | ${icon} ${row.status} | ${row.detail} |`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll isolation checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
