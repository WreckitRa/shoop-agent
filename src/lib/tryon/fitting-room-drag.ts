import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";

/** Hangers already on the rail — id only. */
export const FITTING_HANGER_MIME = "application/x-shoop-fitting-item";
/** Finds / looks dragged from chat onto the stage. */
export const FITTING_PAYLOAD_MIME = "application/x-shoop-fitting-payload";

export type FittingDragPayload =
  | { kind: "item"; item: FittingRoomItem }
  | {
      kind: "look";
      title: string;
      searchId: string;
      lookId: string;
      items: FittingRoomItem[];
    };

export function writeFittingDrag(
  data: DataTransfer,
  payload: FittingDragPayload,
) {
  data.setData(FITTING_PAYLOAD_MIME, JSON.stringify(payload));
  data.setData(
    "text/plain",
    payload.kind === "item" ? payload.item.id : payload.lookId,
  );
  data.effectAllowed = "copy";
}

export function hasFittingPayload(data: DataTransfer) {
  return Array.from(data.types).includes(FITTING_PAYLOAD_MIME);
}

export function readFittingDrag(data: DataTransfer): FittingDragPayload | null {
  const raw = data.getData(FITTING_PAYLOAD_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FittingDragPayload;
    if (parsed.kind === "item" && parsed.item?.id) return parsed;
    if (parsed.kind === "look" && Array.isArray(parsed.items)) return parsed;
    return null;
  } catch {
    return null;
  }
}
