import {
  emptyGuestFashionMemorySnapshot,
  FashionLocalStore,
  type GuestFashionMemorySnapshot,
} from "@/lib/fashion-memory/local/store";
import type { StyleSignalType } from "@/lib/fashion-memory/types";
import { classifyTasteToken } from "@/lib/fashion-memory/scoring/taste-fit";
import type { Persona } from "./persona";

const SIGNAL_TYPE_TOKENS = new Set<string>([
  "color",
  "style",
  "brand",
  "silhouette",
  "aesthetic",
  "material",
  "pattern",
]);

/** Seed a guest fashion-memory snapshot from a persona profile. */
export function seedPersonaSnapshot(
  persona: Persona,
  userId: string,
): { snapshot: GuestFashionMemorySnapshot; selfPersonId: string } {
  const snapshot = emptyGuestFashionMemorySnapshot();
  const store = new FashionLocalStore(snapshot);
  const self = store.ensureSelfPerson(userId);
  const selfId = self.id;
  self.name = persona.name;

  const dept = persona.profile.department;
  if (dept) {
    store.upsertFashionFact({
      userId,
      personId: selfId,
      factType: "gender_presentation",
      value: { presentation: dept },
    });
  }

  for (const [bucket, label] of Object.entries(persona.profile.sizes ?? {})) {
    store.upsertFashionFact({
      userId,
      personId: selfId,
      factType: "size",
      garmentType: bucket,
      value: { value: label, system: "us" },
    });
  }

  if (persona.profile.depth_default) {
    store.upsertFashionFact({
      userId,
      personId: selfId,
      factType: "depth_default",
      value: {
        count: persona.profile.depth_default.count,
        unit: persona.profile.depth_default.unit,
      },
    });
  }

  if (persona.profile.shopping_style) {
    store.upsertStyleSignal({
      userId,
      personId: selfId,
      signalType: "shopping_style",
      value: persona.profile.shopping_style,
      polarity: 1,
      source: "stated",
      status: "active",
    });
  }

  for (const raw of persona.profile.signals ?? []) {
    const m = /^([+-]?)([^\s\[]+)\s*(?:\[([^\]]+)\])?/.exec(raw.trim());
    if (!m) continue;
    const polarity: -1 | 1 = m[1] === "-" ? -1 : 1;
    const value = m[2]!;
    const meta = (m[3] ?? "").toLowerCase();
    const parts = meta.split(",").map((s) => s.trim()).filter(Boolean);
    const context = parts[0] || "general";
    const source = parts.includes("stated") ? ("stated" as const) : ("request" as const);
    const typed = parts.find((p): p is StyleSignalType =>
      SIGNAL_TYPE_TOKENS.has(p),
    );
    const signalType: StyleSignalType = typed ?? classifyTasteToken(value);
    store.upsertStyleSignal({
      userId,
      personId: selfId,
      context,
      signalType,
      value,
      polarity,
      source,
      status: "active",
    });
  }

  for (const pick of persona.profile.recent_picks ?? []) {
    store.upsertStyleSignal({
      userId,
      personId: selfId,
      context: "recent",
      signalType: "garment",
      value: pick,
      polarity: 1,
      source: "request",
      status: "active",
    });
  }

  return { snapshot, selfPersonId: selfId };
}
