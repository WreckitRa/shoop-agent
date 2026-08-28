/**
 * Backfill style_signals.value_canonical and merge same-canonical dupes.
 * Run: npx tsx scripts/backfill-signal-canonical.ts
 */
import { PrismaClient } from "@prisma/client";
import { canonicalizeSignalValue } from "../src/lib/fashion-memory/normalize/signal-canonical";
import type { StyleSignalType } from "../src/lib/fashion-memory/types";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.fashionStyleSignal.findMany({
    where: { status: { in: ["active", "candidate"] } },
    select: {
      id: true,
      personId: true,
      context: true,
      signalType: true,
      value: true,
      valueCanonical: true,
      polarity: true,
      source: true,
      confidence: true,
      evidenceCount: true,
      lastSeenAt: true,
    },
  });

  let updated = 0;
  let merged = 0;
  const bySlot = new Map<string, typeof rows>();

  for (const row of rows) {
    const canonical =
      row.valueCanonical?.trim() ||
      (await canonicalizeSignalValue(
        row.signalType as StyleSignalType,
        row.value,
      ));
    if (canonical !== row.valueCanonical) {
      await prisma.fashionStyleSignal.update({
        where: { id: row.id },
        data: { valueCanonical: canonical },
      });
      updated++;
    }
    const key = `${row.personId}|${row.context}|${row.signalType}|${canonical.toLowerCase()}|${row.polarity}`;
    const group = bySlot.get(key) ?? [];
    group.push({ ...row, valueCanonical: canonical });
    bySlot.set(key, group);
  }

  for (const group of bySlot.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => {
      const src = Number(b.source === "stated") - Number(a.source === "stated");
      if (src) return src;
      return b.confidence - a.confidence;
    });
    const keeper = ranked[0]!;
    const evidence = group.reduce((n, r) => n + r.evidenceCount, 0);
    const lastSeen = group.reduce(
      (d, r) => (r.lastSeenAt > d ? r.lastSeenAt : d),
      keeper.lastSeenAt,
    );
    for (const dup of ranked.slice(1)) {
      await prisma.fashionStyleSignal.update({
        where: { id: dup.id },
        data: { status: "superseded" },
      });
      merged++;
    }
    await prisma.fashionStyleSignal.update({
      where: { id: keeper.id },
      data: { evidenceCount: evidence, lastSeenAt: lastSeen },
    });
  }

  console.log(`canonicalized ${updated}; merged ${merged} duplicate slots`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
