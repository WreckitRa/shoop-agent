"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2, Sparkles, X } from "lucide-react";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";
import {
  findActiveSlotConflict,
  replaceSameTypeLabel,
} from "@/lib/tryon/fitting-room-slot-guard";
import { TryOnComparePanel } from "./TryOnComparePanel";
import {
  useTryOnDrawerStore,
  type FittingRoomItem,
} from "./tryon-drawer-store";
import { useChatStore } from "@/components/chat/chat-store";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { stashChatFocusReturn } from "@/lib/shared/chatFocus";

const PANEL_WIDTH = "min(100vw, 28rem)";

function GarmentShadows({ items }: { items: FittingRoomItem[] }) {
  const shown = items.filter((i) => i.imageUrl).slice(0, 4);
  if (!shown.length) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[55%] w-[42%] animate-pulse rounded-2xl bg-white/35 shadow-lg ring-1 ring-white/40 backdrop-blur-[2px] motion-reduce:animate-none" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0">
      {shown.map((item, index) => {
        const offset = (index - (shown.length - 1) / 2) * 18;
        const rotate = (index - (shown.length - 1) / 2) * 4;
        return (
          <div
            key={item.id}
            className="absolute left-1/2 top-[18%] h-[58%] w-[38%] animate-pulse overflow-hidden rounded-2xl bg-white/25 shadow-[0_12px_40px_rgba(0,0,0,0.18)] ring-1 ring-white/50 backdrop-blur-[1px] motion-reduce:animate-none"
            style={{
              transform: `translateX(calc(-50% + ${offset}px)) rotate(${rotate}deg)`,
              opacity: 0.55 + index * 0.08,
              zIndex: 10 + index,
              animationDelay: `${index * 180}ms`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt=""
              className="size-full object-cover opacity-80 mix-blend-multiply"
            />
          </div>
        );
      })}
    </div>
  );
}

function StageStatusLine() {
  const status = useTryOnDrawerStore((s) => s.status);
  const lookSteps = useTryOnDrawerStore((s) => s.lookSteps);
  const activeIds = useTryOnDrawerStore((s) => s.activeIds);
  const previewLookTitle = useTryOnDrawerStore((s) => s.previewLookTitle);

  if (status === "loading_avatar") return <>Loading your avatar…</>;
  if (status === "starting") {
    return previewLookTitle ?
        <>Starting {previewLookTitle}…</>
      : <>Starting outfit try-on…</>;
  }
  if (status === "processing") {
    const completed = lookSteps.filter((s) => s.status === "completed").length;
    const total = lookSteps.length;
    if (total > 0) {
      const active = lookSteps.find((s) => s.status === "processing");
      return (
        <>
          {previewLookTitle ?
            `Dressing ${previewLookTitle}${active?.title ? ` · ${active.title}` : ""}`
          : `Dressing ${Math.min(completed + 1, total)} of ${total}${
              active?.title ? ` · ${active.title}` : ""
            }`}
        </>
      );
    }
    return previewLookTitle ?
        <>Rendering {previewLookTitle} on you…</>
      : <>Rendering {activeIds.length} piece{activeIds.length === 1 ? "" : "s"} on you…</>;
  }
  if (status === "completed") return <>Here's how it looks on you</>;
  if (status === "failed") return <>Couldn't finish this try-on</>;
  if (status === "idle") return <>Your fitting room</>;
  return null;
}

function RackSlot({
  item,
  isActive,
  activeItems,
  onTry,
  onReplace,
  onRemoveFromRack,
  onRemoveFromAvatar,
  onOpenProduct,
}: {
  item: FittingRoomItem | null;
  isActive: boolean;
  activeItems: FittingRoomItem[];
  onTry: () => void;
  onReplace: () => void;
  onRemoveFromRack: () => void;
  onRemoveFromAvatar: () => void;
  onOpenProduct: () => void;
}) {
  if (!item) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-hairline-soft bg-surface-tint/60 text-[10px] text-ink-muted">
        Empty
      </div>
    );
  }

  const slotConflict =
    item && !isActive ? findActiveSlotConflict(activeItems, item) : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline-soft bg-white p-2">
      <button
        type="button"
        className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface-tint"
        onClick={onOpenProduct}
        disabled={!item.productId}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.title}
            className="size-full object-cover"
          />
        ) : null}
        {isActive ? (
          <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
            On you
          </span>
        ) : null}
      </button>
      <p className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-snug text-ink">
        {item.title}
      </p>
      <div className="flex flex-col gap-1">
        {slotConflict ? (
          <button
            type="button"
            className="rounded-full border border-brand bg-brand px-2 py-1 text-[10px] font-semibold text-white"
            onClick={onReplace}
          >
            {replaceSameTypeLabel(slotConflict)}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-full border border-ink bg-ink px-2 py-1 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!item.tryonSupported || isActive}
            onClick={onTry}
          >
            Try this on
          </button>
        )}
        {isActive ? (
          <button
            type="button"
            className="rounded-full border border-hairline-soft px-2 py-1 text-[10px] font-medium text-ink-secondary"
            onClick={onRemoveFromAvatar}
          >
            Remove from avatar
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-full border border-hairline-soft px-2 py-1 text-[10px] font-medium text-ink-muted"
          onClick={onRemoveFromRack}
        >
          Remove from rack
        </button>
      </div>
    </div>
  );
}

export function TryOnDrawer() {
  const open = useTryOnDrawerStore((s) => s.open);
  const rackIds = useTryOnDrawerStore((s) => s.rackIds);
  const activeIds = useTryOnDrawerStore((s) => s.activeIds);
  const itemsById = useTryOnDrawerStore((s) => s.itemsById);
  const avatarUrl = useTryOnDrawerStore((s) => s.avatarUrl);
  const status = useTryOnDrawerStore((s) => s.status);
  const resultUrl = useTryOnDrawerStore((s) => s.resultUrl);
  const error = useTryOnDrawerStore((s) => s.error);
  const compare = useTryOnDrawerStore((s) => s.compare);
  const variants = useTryOnDrawerStore((s) => s.variants);
  const partialNote = useTryOnDrawerStore((s) => s.partialNote);
  const previewLookTitle = useTryOnDrawerStore((s) => s.previewLookTitle);
  const close = useTryOnDrawerStore((s) => s.close);
  const tryOnItem = useTryOnDrawerStore((s) => s.tryOnItem);
  const removeFromRack = useTryOnDrawerStore((s) => s.removeFromRack);
  const removeFromAvatar = useTryOnDrawerStore((s) => s.removeFromAvatar);
  const sendFeedback = useTryOnDrawerStore((s) => s.sendFeedback);
  const panelRef = useRef<HTMLElement>(null);
  const conversationId = useChatStore((s) => s.activeConversationId);
  const expandProduct = useInlineProductStore((s) => s.expand);

  const activeItems = activeIds
    .map((id) => itemsById[id])
    .filter(Boolean) as FittingRoomItem[];
  const rackItems = rackIds.map((id) => itemsById[id] ?? null);
  const rackSlots = Array.from({ length: MAX_FITTING_ROOM_ITEMS }, (_, index) =>
    rackItems[index] ?? null,
  );

  const openItemProduct = (item: FittingRoomItem) => {
    const productId = item.productId;
    const messageId = item.messageSearchId;
    if (!productId || !messageId) return;
    close();
    if (conversationId) {
      stashChatFocusReturn({
        conversationId,
        messageId,
        productId,
      });
    }
    expandProduct(
      buildInlineProductState(productId, {
        messageId,
        title: item.title,
        imageUrl: item.imageUrl,
        preferredOptions: item.preferredOptions,
        featuredVariant: item.featuredVariant,
        displayPrice: item.price,
      }),
    );
  };

  const busy =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";
  const showResult = Boolean(resultUrl) && status === "completed";

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-tryon-trigger]")) return;
      if (
        target.closest(
          "input, textarea, select, button, a, [contenteditable], [role='button'], [role='link'], [role='textbox']",
        )
      ) {
        return;
      }
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const statusLine = <StageStatusLine />;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label="Fitting room"
      aria-hidden={!open}
      style={{ width: open ? PANEL_WIDTH : "0px" }}
      className={cn(
        "relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-hairline bg-white shadow-[-12px_0_40px_rgba(12,12,12,0.06)] transition-[width] duration-300 ease-out",
        open ? "border-l" : "pointer-events-none border-l-0",
      )}
      data-tryon-drawer
    >
      <div
        style={{ width: PANEL_WIDTH }}
        className={cn("flex h-full min-w-0 flex-col", !open && "invisible")}
      >
        <header className="flex items-center justify-between border-b border-hairline-soft px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand" aria-hidden />
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">
                Fitting room
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {previewLookTitle ?
                `Previewing ${previewLookTitle}`
              : `${rackIds.length}/${MAX_FITTING_ROOM_ITEMS} saved · ${activeIds.length} on you`}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex size-9 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-tint hover:text-ink"
            aria-label="Close fitting room"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {/* shrink-0 + min-h: aspect-ratio alone collapses to 0px in flex scroll parents */}
          <div
            className="relative flex w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-tint ring-1 ring-hairline aspect-[3/4] min-h-[min(52vh,420px)]"
            aria-busy={busy}
          >
            {showResult ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl!}
                alt="Your try-on"
                className="max-h-full max-w-full object-contain"
              />
            ) : avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Your avatar"
                className="absolute inset-0 size-full object-contain object-bottom"
                onError={() => {
                  // Signed URL expired — clear and refetch without closing the drawer
                  const gen = useTryOnDrawerStore.getState().renderGeneration;
                  useTryOnDrawerStore.setState({
                    avatarUrl: null,
                    status: "loading_avatar",
                    error: null,
                  });
                  void fetch("/api/tryon/latest", { cache: "no-store" })
                    .then(async (res) => {
                      if (!res.ok) throw new Error("reload");
                      const body = (await res.json()) as {
                        avatar_url?: string | null;
                      };
                      if (
                        useTryOnDrawerStore.getState().renderGeneration !== gen
                      ) {
                        return;
                      }
                      const url = body.avatar_url ?? null;
                      useTryOnDrawerStore.setState({
                        avatarUrl: url,
                        status: url ? "idle" : "failed",
                        error: url
                          ? null
                          : "Couldn't load your avatar — try again.",
                      });
                    })
                    .catch(() => {
                      if (
                        useTryOnDrawerStore.getState().renderGeneration !== gen
                      ) {
                        return;
                      }
                      useTryOnDrawerStore.setState({
                        status: "failed",
                        error: "Couldn't load your avatar — try again.",
                      });
                    });
                }}
              />
            ) : status === "loading_avatar" ? (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-ink-muted">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <p className="text-xs">Loading avatar…</p>
              </div>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-ink-muted">
                <p className="text-sm text-ink-secondary">
                  Your avatar will show up here once your card is minted.
                </p>
                <button
                  type="button"
                  className="text-sm font-semibold text-[#007AFF] transition hover:underline"
                  onClick={() => {
                    void import("@/components/tryon/self-avatar-store").then(
                      ({ useSelfAvatarStore }) => {
                        useSelfAvatarStore.getState().openCreateFlow();
                      },
                    );
                  }}
                >
                  Complete your card
                </button>
              </div>
            )}

            {busy && avatarUrl ? (
              <>
                <div className="absolute inset-0 bg-ink/15 backdrop-brightness-95" />
                <GarmentShadows items={activeItems.length ? activeItems : rackItems.filter(Boolean) as FittingRoomItem[]} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/55 via-ink/20 to-transparent px-4 pb-4 pt-16">
                  <div className="flex items-center gap-2 text-white">
                    <Loader2
                      className="size-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">{statusLine}</p>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <p className="mt-2 text-[10px] text-ink-muted">{TRYON_DISCLAIMER}</p>

          {status === "idle" && avatarUrl && !resultUrl && !activeIds.length ? (
            <p className="mt-3 text-sm text-ink-secondary">
              Add pieces to your rack, then tap{" "}
              <span className="font-medium text-ink">Try this on</span> to layer
              them on your avatar.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {partialNote && !error && status === "completed" ? (
            <p className="mt-2 text-xs text-ink-muted">{partialNote}</p>
          ) : null}

          {showResult ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-full border border-hairline-soft px-3 py-1 text-xs"
                onClick={() => sendFeedback(1)}
                aria-label="Helpful try-on"
              >
                👍 Helpful
              </button>
              <button
                type="button"
                className="rounded-full border border-hairline-soft px-3 py-1 text-xs"
                onClick={() => sendFeedback(-1)}
                aria-label="Unhelpful try-on"
              >
                👎 Not quite
              </button>
            </div>
          ) : null}

          {compare && variants.length > 0 && status !== "failed" ? (
            <div className="mt-4">
              <TryOnComparePanel
                variants={variants}
                items={activeItems.map((item) => ({
                  ref: item.id,
                  title: item.title,
                  price: item.price,
                }))}
                badgesByRef={Object.fromEntries(
                  activeItems
                    .filter((item) => item.badges?.length)
                    .map((item) => [item.id, item.badges!]),
                )}
                onOpenProduct={(ref) => {
                  const item = itemsById[ref];
                  if (item) openItemProduct(item);
                }}
                onFeedback={(generationId, rating) =>
                  sendFeedback(rating, generationId)
                }
              />
            </div>
          ) : null}

          {activeItems.length ? (
            <section className="mt-5 border-t border-hairline-soft pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                On your avatar
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {activeItems.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 py-1 pl-1 pr-2">
                      <div className="size-8 overflow-hidden rounded-full bg-surface-tint">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : null}
                      </div>
                      <span className="max-w-[8rem] truncate text-[11px] font-medium text-ink">
                        {item.title}
                      </span>
                      <button
                        type="button"
                        className="text-[10px] font-medium text-ink-muted underline-offset-2 hover:underline"
                        onClick={() => removeFromAvatar(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-5 border-t border-hairline-soft pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Candidate rack
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {rackSlots.map((item, index) => (
                <RackSlot
                  key={item?.id ?? `empty-${index}`}
                  item={item}
                  isActive={item ? activeIds.includes(item.id) : false}
                  activeItems={activeItems}
                  onTry={() => item && tryOnItem(item.id)}
                  onReplace={() =>
                    item && tryOnItem(item.id, { replaceSameType: true })
                  }
                  onRemoveFromRack={() => item && removeFromRack(item.id)}
                  onRemoveFromAvatar={() => item && removeFromAvatar(item.id)}
                  onOpenProduct={() => item && openItemProduct(item)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}
