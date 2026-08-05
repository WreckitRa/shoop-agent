"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";
import { StudyingScan } from "./StudyingScan";
import { TryOnComparePanel } from "./TryOnComparePanel";
import {
  useTryOnDrawerStore,
  type FittingRoomItem,
} from "./tryon-drawer-store";
import { useChatStore } from "@/components/chat/chat-store";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { stashChatFocusReturn } from "@/lib/shared/chatFocus";
import { guestFetch } from "@/lib/client/guest-fetch";

const DRAG_MIME = "application/x-shoop-fitting-item";

type Verdict = "no" | "meh" | "almost" | "love";

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
}

function badgeFact(
  badge: RenderPickBadge,
): { label: string; good: boolean } | null {
  switch (badge.kind) {
    case "size_converted":
      return {
        label: `${badge.merchant_label} — your ${badge.from}`,
        good: true,
      };
    case "size_unknown":
      return { label: "check sizing", good: false };
    case "material_suspected":
      return { label: `may contain ${badge.material}`, good: false };
    case "photo_color":
      return { label: `photo shows: ${badge.color}`, good: false };
    case "near_budget_lifted":
      return { label: "slightly over budget", good: false };
    case "brand_unconfirmed":
      return { label: "brand unconfirmed", good: false };
    default:
      return null;
  }
}

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
  if (status === "idle") return <>Drop clothes on me</>;
  return null;
}

function StylistPanel({
  activeItems,
  lastDropped,
  onDecide,
}: {
  activeItems: FittingRoomItem[];
  lastDropped: FittingRoomItem | null;
  onDecide: () => void;
}) {
  const facts = useMemo(() => {
    const out: Array<{ label: string; good: boolean }> = [];
    const seen = new Set<string>();
    for (const item of activeItems) {
      for (const badge of item.badges ?? []) {
        const fact = badgeFact(badge);
        if (!fact || seen.has(fact.label)) continue;
        seen.add(fact.label);
        out.push(fact);
      }
    }
    return out.slice(0, 6);
  }, [activeItems]);

  const line = useMemo(() => {
    if (lastDropped) {
      return (
        <>
          Adding the <b>{lastDropped.title}</b>
          {activeItems.length > 1 ?
            "… this slots right into the look."
          : "… let's see how it sits on you."}
        </>
      );
    }
    if (!activeItems.length) {
      return (
        <>
          Drag pieces from <b>THE RAIL</b> onto the mirror — I'll tell you what
          I'd say if we were standing here together.
        </>
      );
    }
    const names = activeItems.map((i) => i.title).slice(0, 3);
    const joined =
      names.length === 1 ? names[0]!
      : names.length === 2 ? `${names[0]} with the ${names[1]}`
      : `${names[0]}, ${names[1]}, and ${names[2]}`;
    return (
      <>
        The <b>{joined}</b> reads like the brief — relaxed where it should be,
        intentional where it counts.
      </>
    );
  }, [activeItems, lastDropped]);

  return (
    <div className="shoop-croom__side relative">
      <div className="shoop-stylist-say">
        <div className="shoop-stylist-say__sh">
          <ShoopIcon size={18} className="rounded-[5px]" />
          WHAT I&apos;D TELL YOU IN THE MIRROR
        </div>
        <p>{line}</p>
        {facts.length ? (
          <div className="shoop-fitfacts">
            {facts.map((fact) => (
              <span
                key={fact.label}
                className={cn("shoop-ff", fact.good && "shoop-ff--good")}
              >
                {fact.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="shoop-quiz-apply mt-3.5"
        onClick={onDecide}
        disabled={!activeItems.length}
      >
        Love it… decide
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

function RailHanger({
  item,
  wearing,
  hearted,
  onHeart,
  onDragStart,
}: {
  item: FittingRoomItem;
  wearing: boolean;
  hearted: boolean;
  onHeart: () => void;
  onDragStart: (event: DragEvent, id: string) => void;
}) {
  return (
    <div
      className="shoop-h2g"
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
    >
      <span className="shoop-h2g__sw">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" draggable={false} />
        ) : null}
      </span>
      <div className="shoop-h2g__hi">
        <b>{item.title}</b>
        {item.price ? <i>{formatPrice(item.price)}</i> : null}
        {wearing ? <span className="shoop-h2g__wr">WEARING</span> : null}
      </div>
      <button
        type="button"
        className={cn("shoop-h2g__hb", hearted && "shoop-h2g__hb--on")}
        aria-label={hearted ? "Saved to moodboard" : "Save to moodboard"}
        aria-pressed={hearted}
        onClick={(e) => {
          e.stopPropagation();
          onHeart();
        }}
      >
        {hearted ? "♥" : "♡"}
      </button>
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
  const close = useTryOnDrawerStore((s) => s.close);
  const tryOnItem = useTryOnDrawerStore((s) => s.tryOnItem);
  const sendFeedback = useTryOnDrawerStore((s) => s.sendFeedback);
  const jobId = useTryOnDrawerStore((s) => s.jobId);

  const panelRef = useRef<HTMLDivElement>(null);
  const conversationId = useChatStore((s) => s.activeConversationId);
  const expandProduct = useInlineProductStore((s) => s.expand);
  const router = useRouter();

  const [dropGlow, setDropGlow] = useState(false);
  const [lastDroppedId, setLastDroppedId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [helpRating, setHelpRating] = useState<1 | -1 | null>(null);
  const [heartedIds, setHeartedIds] = useState<Set<string>>(() => new Set());
  const [moodCount, setMoodCount] = useState<number | null>(null);

  const activeItems = activeIds
    .map((id) => itemsById[id])
    .filter(Boolean) as FittingRoomItem[];
  const rackItems = rackIds
    .map((id) => itemsById[id])
    .filter(Boolean) as FittingRoomItem[];
  const lastDropped =
    lastDroppedId ? (itemsById[lastDroppedId] ?? null) : null;

  const busy =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";
  const showResult = Boolean(resultUrl) && status === "completed";
  const mirrorSrc = showResult ? resultUrl! : avatarUrl;

  useEffect(() => {
    if (!open) return;
    setVerdict(null);
    setHelpRating(null);
    void guestFetch("/api/tryon/moodboard", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { items?: unknown[] };
        setMoodCount(body.items?.length ?? 0);
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

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

  const dressItem = useCallback(
    (id: string) => {
      const item = itemsById[id];
      if (!item) return;
      setLastDroppedId(id);
      // Drag-drop replaces same garment slot so hangers feel instant.
      tryOnItem(id, { replaceSameType: true });
    },
    [itemsById, tryOnItem],
  );

  const onDragStart = (event: DragEvent, id: string) => {
    event.dataTransfer.setData(DRAG_MIME, id);
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "copyMove";
  };

  const onDropOnMirror = (event: DragEvent) => {
    event.preventDefault();
    setDropGlow(false);
    const id =
      event.dataTransfer.getData(DRAG_MIME) ||
      event.dataTransfer.getData("text/plain");
    if (!id) return;
    dressItem(id);
  };

  const heartItem = (id: string) => {
    setHeartedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (jobId) sendFeedback(1);
        setMoodCount((n) => (typeof n === "number" ? n + 1 : n));
      }
      return next;
    });
  };

  const onVerdict = (next: Verdict) => {
    setVerdict(next);
    if (next === "love") {
      if (jobId) sendFeedback(1);
      setMoodCount((n) => (typeof n === "number" ? n + 1 : n));
    }
  };

  const onDecide = () => {
    if (jobId) sendFeedback(1);
    setVerdict("love");
    close();
    router.push("/moodboard");
  };

  if (!open) return null;

  return (
    <div
      className="shoop-croom-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Changing room"
        aria-modal="true"
        className="shoop-croom relative"
        data-tryon-drawer
      >
        <button
          type="button"
          className="shoop-croom-close"
          onClick={close}
          aria-label="Close changing room"
        >
          <X className="size-4" strokeWidth={2} />
        </button>

        <StylistPanel
          activeItems={activeItems}
          lastDropped={lastDropped}
          onDecide={onDecide}
        />

        <div className="shoop-croom__rail">
          <div className="shoop-rh">
            THE RAIL
            <span>drag onto me · ♥ to board</span>
          </div>
          <div className="shoop-hangrail">
            {rackItems.length ? (
              rackItems.map((item) => (
                <RailHanger
                  key={item.id}
                  item={item}
                  wearing={activeIds.includes(item.id)}
                  hearted={heartedIds.has(item.id)}
                  onHeart={() => heartItem(item.id)}
                  onDragStart={onDragStart}
                />
              ))
            ) : (
              <p className="py-4 text-center text-[11px] text-ink-muted">
                Add pieces from the rack — they hang here.
              </p>
            )}
          </div>
          <div className="shoop-draghint">
            grab a hanger → drop it on the mirror
          </div>
          <Link href="/moodboard" className="shoop-mooddock" onClick={close}>
            <span>My Moodboard</span>
            <span className="shoop-mooddock__n">{moodCount ?? "·"}</span>
          </Link>
        </div>

        <div className="shoop-croom__mirror">
          <div className="shoop-twinlbl">
            <ShoopIcon size={18} className="rounded-[5px]" />
            THE MIRROR · DROP CLOTHES ON ME
          </div>

          <div
            className={cn("shoop-twin", dropGlow && "shoop-twin--glow")}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropGlow(true);
            }}
            onDragLeave={() => setDropGlow(false)}
            onDrop={onDropOnMirror}
            aria-busy={busy}
          >
            {mirrorSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mirrorSrc}
                alt={showResult ? "Your try-on" : "Your avatar"}
                onError={() => {
                  if (showResult) return;
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
                  className="text-sm font-semibold text-brand transition hover:underline"
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
                <GarmentShadows
                  items={
                    activeItems.length ?
                      activeItems
                    : rackItems
                  }
                />
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink/55 via-ink/20 to-transparent px-4 pb-10 pt-16">
                  <div className="flex items-center gap-2 text-white">
                    <Loader2
                      className="size-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">
                      <StageStatusLine />
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            <span className="shoop-twin__tag">{TRYON_DISCLAIMER}</span>
            <span className="shoop-twin__state">
              DRESSED {activeIds.length} ✓
            </span>
          </div>

          {error ? (
            <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {partialNote && !error && status === "completed" ? (
            <p className="mt-2 text-center text-xs text-ink-muted">
              {partialNote}
            </p>
          ) : null}

          {showResult && resultUrl ? (
            <StudyingScan
              imageUrl={resultUrl}
              pieces={activeItems.map((item) => ({
                title: item.title,
                priceLabel: item.price ? formatPrice(item.price) : undefined,
                garment: item.garment,
              }))}
              className="mt-3"
            />
          ) : null}

          <div className="shoop-verdict-strip">
            {(
              [
                ["no", "No"],
                ["meh", "Meh"],
                ["almost", "Almost"],
                ["love", "♥ Love it"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "shoop-vbtn",
                  `shoop-vbtn--${key}`,
                  verdict === key && "on",
                )}
                onClick={() => onVerdict(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="shoop-help-row">
            <button
              type="button"
              className={cn(
                "shoop-help-chip",
                helpRating === 1 && "shoop-help-chip--on",
              )}
              onClick={() => {
                setHelpRating(1);
                sendFeedback(1);
              }}
            >
              👍 Helpful
            </button>
            <button
              type="button"
              className={cn(
                "shoop-help-chip",
                helpRating === -1 && "shoop-help-chip--on",
              )}
              onClick={() => {
                setHelpRating(-1);
                sendFeedback(-1);
              }}
            >
              👎 Not quite
            </button>
          </div>

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
        </div>
      </div>
    </div>
  );
}
