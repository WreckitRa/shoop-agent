/**
 * One-off: create branch index 0 per conversation and set message.branchId.
 * Run: npx tsx scripts/backfill-conversation-branches.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const conversations = await prisma.conversation.findMany({
    select: { id: true, title: true },
  });

  let created = 0;
  let skipped = 0;

  for (const conv of conversations) {
    const existing = await prisma.conversationBranch.findFirst({
      where: { conversationId: conv.id, index: 0 },
    });
    if (existing) {
      skipped++;
      await prisma.message.updateMany({
        where: { conversationId: conv.id, branchId: null },
        data: { branchId: existing.id },
      });
      continue;
    }

    const firstUser = await prisma.message.findFirst({
      where: { conversationId: conv.id, role: "user" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const firstAny = await prisma.message.findFirst({
      where: { conversationId: conv.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const anchorId = firstUser?.id ?? firstAny?.id;
    if (!anchorId) {
      skipped++;
      continue;
    }

    const branch = await prisma.conversationBranch.create({
      data: {
        conversationId: conv.id,
        index: 0,
        title: conv.title.trim() || "New Shoop",
        anchorMessageId: anchorId,
      },
    });
    await prisma.message.updateMany({
      where: { conversationId: conv.id },
      data: { branchId: branch.id },
    });
    created++;
  }

  console.log(
    `Backfill done: ${created} branches created, ${skipped} already had branch 0 or empty conv.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
