import type { FittingRoomItem } from "./fitting-room-types";
import { mapSlotToGarmentType } from "./garment-type";
import type { GarmentType } from "./types";

const SLOT_LABELS: Record<GarmentType, string> = {
  top: "a top",
  bottom: "bottoms",
  shoes: "shoes",
  dress: "a dress",
  outerwear: "a layer",
};

export function fittingRoomGarmentType(
  item: Pick<FittingRoomItem, "garment" | "title">,
): GarmentType | null {
  return mapSlotToGarmentType(item.garment ?? item.title, item.title);
}

export type ActiveSlotConflict = {
  type: GarmentType;
  activeId: string;
  label: string;
};

export function findActiveSlotConflict(
  activeItems: FittingRoomItem[],
  candidate: FittingRoomItem,
): ActiveSlotConflict | null {
  const candidateType = fittingRoomGarmentType(candidate);
  if (!candidateType) return null;

  for (const active of activeItems) {
    if (active.id === candidate.id) continue;
    const activeType = fittingRoomGarmentType(active);
    if (activeType === candidateType) {
      return {
        type: candidateType,
        activeId: active.id,
        label: SLOT_LABELS[candidateType],
      };
    }
  }
  return null;
}

export function slotGuardMessage(conflict: ActiveSlotConflict): string {
  return `You already have ${conflict.label} on your avatar. Remove them first, or replace with this piece.`;
}

export function replaceSameTypeLabel(conflict: ActiveSlotConflict): string {
  const verb =
    conflict.type === "bottom" ? "Replace bottoms"
    : conflict.type === "top" ? "Replace top"
    : conflict.type === "shoes" ? "Replace shoes"
    : conflict.type === "dress" ? "Replace dress"
    : "Replace layer";
  return verb;
}
