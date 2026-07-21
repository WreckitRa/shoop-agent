"use client";

import type { RenderPick } from "@/lib/fashion-memory/types/render-contract";
import { FittingRoomAction } from "./FittingRoomAction";
import { fittingRoomItemFromSearchPick } from "./fitting-room-item-builders";

type TryOnPickButtonProps = {
  pick: RenderPick;
  searchId: string;
  onImageReady?: (imageUrl: string, jobId: string) => void;
};

export function TryOnPickButton({ pick, searchId }: TryOnPickButtonProps) {
  const item = fittingRoomItemFromSearchPick({ pick, searchId });

  return (
    <div className="mt-2">
      <FittingRoomAction
        item={item}
        tryonAvailable={pick.tryon?.available}
        tryonCta={pick.tryon?.cta}
      />
    </div>
  );
}
