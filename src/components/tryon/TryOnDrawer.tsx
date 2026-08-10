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
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { StudyingScan } from "./StudyingScan";
import { TryOnComparePanel } from "./TryOnComparePanel";
import {
  useTryOnDrawerStore,
  type FittingRoomItem,
} from "./tryon-drawer-store";
import { useChatStore } from "@/components/chat/chat-store";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useCartStore } from "@/components/cart/cart-store";

const DRAG_MIME = "application/x-shoop-fitting-item";

type MoodPeekItem = {
  id: string;
  imageUrl: string;
  title?: string;
};

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
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
  if (status === "completed") return <>Here&apos;s how it looks on you</>;
  if (status === "failed") return <>Couldn&apos;t finish this try-on</>;
  if (status === "idle") return <>Drop clothes on me</>;
  return null;
}

function MoodboardPeek({
  localHearts,
  count,
  onNavigate,
}: {
  localHearts: MoodPeekItem[];
  count: number | null;
  onNavigate: () => void;
}) {
  const [remote, setRemote] = useState<MoodPeekItem[]>([]);
  const [remoteTotal, setRemoteTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await guestFetch("/api/tryon/moodboard", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          items?: Array<{ generationId: string; imageUrl: string; title: string }>;
        };
        if (cancelled) return;
        const items = body.items ?? [];
        setRemoteTotal(items.length);
        setRemote(
          items
            .filter((i) => i.imageUrl)
            .slice(0, 4)
            .map((i) => ({
              id: i.generationId,
              imageUrl: i.imageUrl,
              title: i.title,
            })),
        );
      } catch {
        /* sneak peek is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const previews = useMemo(() => {
    const seen = new Set<string>();
    const out: MoodPeekItem[] = [];
    for (const item of [...localHearts, ...remote]) {
      if (!item.imageUrl || seen.has(item.imageUrl)) continue;
      seen.add(item.imageUrl);
      out.push(item);
      if (out.length >= 4) break;
    }
    return out;
  }, [localHearts, remote]);

  const n = Math.max(count ?? 0, remoteTotal, previews.length);

  return (
    <div className="shoop-cboard">
      <div className="shoop-cboard__top">
        <h3>My moodboard</h3>
        <span className="shoop-cboard__count">{n}</span>
      </div>
      <Link
        href="/moodboard"
        className="shoop-cboard__peek"
        onClick={onNavigate}
        aria-label={`My moodboard, ${n} items`}
      >
        {previews.map((item) => (
          <span key={item.id} className="shoop-cboard__tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          </span>
        ))}
        <span className="shoop-cboard__tile shoop-cboard__tile--more">
          {n > 4 ? `+${n - 4}` : "+"}
        </span>
      </Link>
    </div>
  );
}

function RailHanger({
  item,
  wearing,
  hearted,
  onHeart,
  onWear,
  onUnwear,
  onDragStart,
}: {
  item: FittingRoomItem;
  wearing: boolean;
  hearted: boolean;
  onHeart: () => void;
  onWear: () => void;
  onUnwear: () => void;
  onDragStart: (event: DragEvent, id: string) => void;
}) {
  return (
    <div
      className={cn("shoop-h2g", wearing && "shoop-h2g--worn")}
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => onDragStart(e, item.id)}
      onClick={() => {
        if (wearing) onUnwear();
        else onWear();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (wearing) onUnwear();
          else onWear();
        }
      }}
    >
      <span className="shoop-h2g__sw">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" draggable={false} />
        ) : null}
      </span>
      <div className="shoop-h2g__hi">
        <b>{item.title}</b>
        <i>{item.price ? formatPrice(item.price) : "—"}</i>
      </div>
      <span className="shoop-h2g__grip">{wearing ? "On" : "Drag"}</span>
      <button
        type="button"
        className={cn("shoop-h2g__hb", hearted && "shoop-h2g__hb--on")}
        aria-label={hearted ? "Remove from moodboard" : "Save to moodboard"}
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
  const removeFromAvatar = useTryOnDrawerStore((s) => s.removeFromAvatar);
  const sendFeedback = useTryOnDrawerStore((s) => s.sendFeedback);
  const jobId = useTryOnDrawerStore((s) => s.jobId);
  const hydrateAskShareForJob = useTryOnDrawerStore(
    (s) => s.hydrateAskShareForJob,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const expandProduct = useInlineProductStore((s) => s.expand);
  const setChatInput = useChatStore((s) => s.setInput);
  const sendChatMessage = useChatStore((s) => s.sendMessage);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  const [dropGlow, setDropGlow] = useState(false);
  const [lastDroppedId, setLastDroppedId] = useState<string | null>(null);
  const [heartedIds, setHeartedIds] = useState<Set<string>>(() => new Set());
  const [moodCount, setMoodCount] = useState<number | null>(null);
  const [twinEl, setTwinEl] = useState<HTMLDivElement | null>(null);
  const [scanScanning, setScanScanning] = useState(false);
  const [dressFlash, setDressFlash] = useState<string | null>(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [roomChat, setRoomChat] = useState("");
  const [roomChatBusy, setRoomChatBusy] = useState(false);
  const addCartItem = useCartStore((s) => s.addItem);

  const activeItems = activeIds
    .map((id) => itemsById[id])
    .filter(Boolean) as FittingRoomItem[];
  const rackItems = rackIds
    .map((id) => itemsById[id])
    .filter(Boolean) as FittingRoomItem[];

  const busy =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";
  const showResult = Boolean(resultUrl) && status === "completed";
  // Don't swap the mirror / start StudyingScan until the dressed look has
  // actually loaded — otherwise the scan choreography runs on the bare avatar.
  const [lookPainted, setLookPainted] = useState(false);
  const mirrorSrc =
    showResult && lookPainted && resultUrl ? resultUrl : avatarUrl;

  useEffect(() => {
    setLookPainted(false);
    setScanScanning(false);
    if (!showResult || !resultUrl) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setLookPainted(true);
    };
    img.onerror = () => {
      // Still reveal + study — better a scan on a broken frame than a hang.
      if (!cancelled) setLookPainted(true);
    };
    img.src = resultUrl;
    if (img.complete && img.naturalWidth > 0) {
      setLookPainted(true);
    }
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [showResult, resultUrl]);

  const localHeartPreviews = useMemo(() => {
    const out: MoodPeekItem[] = [];
    for (const id of heartedIds) {
      const item = itemsById[id];
      if (item?.imageUrl) {
        out.push({ id, imageUrl: item.imageUrl, title: item.title });
      }
    }
    return out;
  }, [heartedIds, itemsById]);

  useEffect(() => {
    setActionHint(null);
  }, [resultUrl]);

  useEffect(() => {
    if (!open) setRoomChat("");
  }, [open]);

  useEffect(() => {
    if (!open || !jobId) return;
    hydrateAskShareForJob(jobId);
  }, [open, jobId, hydrateAskShareForJob]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const dressItem = useCallback(
    (id: string) => {
      const item = itemsById[id];
      if (!item) return;
      const replaced = activeIds
        .map((aid) => itemsById[aid])
        .find(
          (other) =>
            other &&
            other.id !== id &&
            other.garment &&
            item.garment &&
            other.garment === item.garment,
        );
      setLastDroppedId(id);
      setDressFlash(
        replaced
          ? `Swapping ${replaced.title} → ${item.title}`
          : `Putting on ${item.title}`,
      );
      window.setTimeout(() => setDressFlash(null), 2200);
      tryOnItem(id, { replaceSameType: true });
    },
    [itemsById, tryOnItem, activeIds],
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

  const sendRoomChat = async () => {
    const text = roomChat.trim();
    if (!text || roomChatBusy) return;
    setRoomChatBusy(true);
    try {
      const worn = activeItems.map((i) => i.title).filter(Boolean);
      const payload =
        worn.length > 0
          ? `About this try-on look (${worn.join(", ")}): ${text}`
          : text;
      setChatInput(payload);
      setRoomChat("");
      close();
      requestComposerFocus();
      await sendChatMessage();
    } finally {
      setRoomChatBusy(false);
    }
  };

  const addLookToMoodboard = () => {
    setActionHint(null);
    setMoodBusy(true);
    try {
      if (jobId) sendFeedback(1);
      for (const item of activeItems) {
        setHeartedIds((prev) => new Set(prev).add(item.id));
      }
      setMoodCount((n) =>
        typeof n === "number" ? n + Math.max(1, activeItems.length) : activeItems.length || 1,
      );
      setActionHint("Saved to your moodboard");
    } finally {
      setMoodBusy(false);
    }
  };

  const addLookToCart = async () => {
    setActionHint(null);
    setCartBusy(true);
    try {
      let added = 0;
      let skipped = 0;
      for (const item of activeItems) {
        const variant = item.featuredVariant;
        if (!variant?.id || !variant.checkoutUrl) {
          skipped += 1;
          continue;
        }
        const ok = await addCartItem({
          variantId: variant.id,
          checkoutUrl: variant.checkoutUrl,
          quantity: 1,
          product: {
            title: item.title,
            imageUrl: item.imageUrl,
            productId: item.productId,
            priceCents: item.price?.amount ?? variant.price?.amount ?? null,
            currency: item.price?.currency ?? variant.price?.currency ?? null,
          },
        });
        if (ok) added += 1;
        else skipped += 1;
      }
      if (added > 0 && skipped === 0) {
        setActionHint(
          added === 1 ? "Added to cart" : `Added ${added} pieces to cart`,
        );
      } else if (added > 0) {
        setActionHint(
          `Added ${added} · ${skipped} need a size on the product page`,
        );
      } else {
        setActionHint("Open a piece to pick a size, then add to cart");
      }
    } finally {
      setCartBusy(false);
    }
  };

  const openItemProduct = (item: FittingRoomItem) => {
    const productId = item.productId ?? item.id;
    const messageId =
      item.messageSearchId ??
      (item.provenance.kind === "search" ? item.provenance.searchId : null);
    if (!messageId) return;
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

  if (!open) return null;

  const dressedLabel =
    activeItems.length === 0
      ? "Nothing on yet"
      : `${activeItems.length} piece${activeItems.length > 1 ? "s" : ""} on`;

  return (
    <div className="shoop-croom-overlay" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Changing room"
        aria-modal="true"
        className="shoop-croom relative"
        data-tryon-drawer
      >
        <aside className="shoop-croom__side">
          <div className="shoop-croom__eyebrow">
            <span className="shoop-croom__dot" aria-hidden />
            <h1>What I&apos;d tell you in the mirror</h1>
          </div>

          <div className="shoop-croom__rail-block">
            <div className="shoop-rh">
              <h2>The Rail</h2>
              <span>
                {rackItems.length
                  ? `${rackItems.length} piece${rackItems.length > 1 ? "s" : ""} pulled`
                  : "empty"}
              </span>
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
                    onWear={() => dressItem(item.id)}
                    onUnwear={() => removeFromAvatar(item.id)}
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
              Drag a piece onto the mirror <b>· or tap to try it</b>
            </div>
          </div>

          <MoodboardPeek
            localHearts={localHeartPreviews}
            count={moodCount}
            onNavigate={close}
          />

          <form
            className="shoop-croom__ask"
            onSubmit={(e) => {
              e.preventDefault();
              void sendRoomChat();
            }}
          >
            <div className="shoop-croom__askbox">
              <input
                type="text"
                value={roomChat}
                onChange={(e) => setRoomChat(e.target.value)}
                placeholder="Tell me what you're looking for..."
                aria-label="Tell Shoop what you're looking for"
                disabled={roomChatBusy}
              />
              <button
                type="submit"
                className="shoop-croom__ask-send"
                disabled={roomChatBusy || !roomChat.trim()}
                aria-label="Send"
              >
                →
              </button>
            </div>
          </form>
        </aside>

        <div className="shoop-croom__mirror">
          <div className="shoop-croom__mhead">
            <div className="shoop-croom__mlbl">
              <span className="shoop-croom__dot" aria-hidden />
              <h2>The Mirror</h2>
            </div>
            <div className="shoop-croom__mhead-actions">
              <span className="shoop-croom__dressed">{dressedLabel}</span>
              <button
                type="button"
                className="shoop-croom-close"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Defer unmount so this click cannot fall through to a
                  // link under the overlay (moodboard / product / home).
                  window.setTimeout(() => close(), 0);
                }}
                aria-label="Close changing room"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          <div
            ref={setTwinEl}
            className={cn(
              "shoop-twin",
              dropGlow && "shoop-twin--glow",
              scanScanning && "shoop-twin--scanning",
              showResult && lookPainted && "shoop-twin--studied",
              Boolean(dressFlash) && "shoop-twin--dressing",
            )}
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
                alt={showResult && lookPainted ? "Your try-on" : "Your avatar"}
                onError={() => {
                  if (showResult && lookPainted) return;
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
                  items={activeItems.length ? activeItems : rackItems}
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

            {dropGlow ? (
              <div className="shoop-twin__dropcue" aria-hidden>
                <span>Drop it on me</span>
              </div>
            ) : null}

            {!showResult || !lookPainted ? (
              <span className="shoop-twin__tag">{TRYON_DISCLAIMER}</span>
            ) : null}

            {dressFlash ? (
              <div className="shoop-twin__dress-flash" role="status">
                {dressFlash}
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mx-4 mt-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {partialNote && !error && status === "completed" ? (
            <p className="mx-4 mt-2 text-center text-xs text-ink-muted">
              {partialNote}
            </p>
          ) : null}

          <div className="shoop-croom__readout">
            {showResult && resultUrl && lookPainted ? (
              <StudyingScan
                key={resultUrl}
                imageUrl={resultUrl}
                frameEl={twinEl}
                onScanningChange={setScanScanning}
                pieces={activeItems.map((item) => ({
                  title: item.title,
                  priceLabel: item.price ? formatPrice(item.price) : undefined,
                  garment: item.garment,
                }))}
                onAddToMoodboard={addLookToMoodboard}
                onAddToCart={addLookToCart}
                moodBusy={moodBusy}
                cartBusy={cartBusy}
                actionHint={actionHint}
              />
            ) : (
              <p className="shoop-sscan__empty">
                {busy
                  ? "Dressing your twin — Shoop's take lands here when the look is ready."
                  : showResult && !lookPainted
                    ? "Bringing the look into the mirror…"
                    : "Pull something off the rail and I'll tell you what I'd say if we were standing here together."}
              </p>
            )}

            {compare && variants.length > 0 && status !== "failed" ? (
              <div className="mt-3">
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
    </div>
  );
}
