"use client";

import { useEffect, useState } from "react";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";

export type TodayTile = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  source: "moodboard" | "rack";
};

type Props = {
  onPreview: (imageUrl: string | null) => void;
  className?: string;
};

/**
 * “TODAY, ON YOU” — real loved try-ons + fitting-room rack (no mock products).
 */
export function HomeTodayOnYou({ onPreview, className }: Props) {
  const rackIds = useTryOnDrawerStore((s) => s.rackIds);
  const itemsById = useTryOnDrawerStore((s) => s.itemsById);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const setInput = useChatStore((s) => s.setInput);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);
  const [loved, setLoved] = useState<TodayTile[]>([]);

  useEffect(() => {
    let cancelled = false;
    void guestFetch("/api/tryon/moodboard", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as {
          items?: Array<{
            generationId: string;
            imageUrl: string;
            title: string;
            kind: string;
          }>;
        };
        if (cancelled) return;
        setLoved(
          (body.items ?? []).slice(0, 3).map((item) => ({
            id: item.generationId,
            title: item.title,
            subtitle:
              item.kind === "look" ? "loved look · on you" : "loved try-on · on you",
            imageUrl: item.imageUrl,
            source: "moodboard" as const,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setLoved([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rackTiles: TodayTile[] = rackIds
    .map((id) => itemsById[id])
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.imageUrl))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: item.price
        ? `in rack · ${formatPrice(item.price.amount, item.price.currency)}`
        : "in your fitting room",
      imageUrl: item.imageUrl!,
      source: "rack" as const,
    }));

  // Prefer rack (active session), then moodboard loves.
  const tiles = (rackTiles.length > 0 ? rackTiles : loved).slice(0, 3);

  if (tiles.length === 0) return null;

  return (
    <section className={cn("mt-7", className)}>
      <p className="font-display text-[12px] font-extrabold tracking-[0.06em] text-ink">
        TODAY, ON YOU{" "}
        <span className="ml-2 text-[11px] font-semibold tracking-normal text-ink-muted">
          no rush… just looking
        </span>
      </p>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="w-[172px] shrink-0 overflow-hidden rounded-[15px] border border-hairline bg-white text-left transition duration-150 hover:-translate-y-[3px]"
            onMouseEnter={() => onPreview(tile.imageUrl)}
            onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(tile.imageUrl)}
            onBlur={() => onPreview(null)}
            onClick={() => {
              if (tile.source === "rack") {
                openFittingRoom();
                return;
              }
              setInput(`Tell me more about this look I loved: ${tile.title}`);
              requestComposerFocus();
            }}
          >
            <div className="relative h-[152px] overflow-hidden bg-[#F1F1F4]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tile.imageUrl}
                alt=""
                className="size-full object-cover object-top"
              />
              <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-[8px] font-black tracking-[0.08em] text-ink">
                ON YOU
              </span>
            </div>
            <div className="px-[11px] py-[9px] text-[11px]">
              <b className="block font-semibold text-ink">{tile.title}</b>
              <i className="mt-0.5 block not-italic text-[10px] text-ink-muted">
                {tile.subtitle}
              </i>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}
