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
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useCartStore } from "@/components/cart/cart-store";
import { cartContainsVariant } from "@/lib/cart/variant-id";
import {
  FITTING_HANGER_MIME,
  hasFittingPayload,
  readFittingDrag,
} from "@/lib/tryon/fitting-room-drag";

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
      className={cn("shoop-fitcard", wearing && "shoop-fitcard--worn")}
      draggable
      role="button"
      tabIndex={0}
      title={`${item.title}${item.price ? ` · ${formatPrice(item.price)}` : ""}`}
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
      <div className="shoop-fitcard__im">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" draggable={false} />
        ) : null}
        {item.price ? (
          <span className="shoop-fitcard__pr">{formatPrice(item.price)}</span>
        ) : null}
        <button
          type="button"
          className={cn("shoop-fitcard__heart", hearted && "is-on")}
          aria-label={hearted ? "Remove from moodboard" : "Save to moodboard"}
          onClick={(e) => {
            e.stopPropagation();
            onHeart();
          }}
        >
          {hearted ? "♥" : "♡"}
        </button>
      </div>
    </div>
  );
}

export function FittingStage({
  layout = "inline",
  peekUrl = null,
}: {
  layout?: "inline" | "overlay";
  peekUrl?: string | null;
}) {
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
  const warmAvatar = useTryOnDrawerStore((s) => s.warmAvatar);
  const removeFromAvatar = useTryOnDrawerStore((s) => s.removeFromAvatar);
  const sendFeedback = useTryOnDrawerStore((s) => s.sendFeedback);
  const jobId = useTryOnDrawerStore((s) => s.jobId);
  const renderGeneration = useTryOnDrawerStore((s) => s.renderGeneration);
  const hydrateAskShareForJob = useTryOnDrawerStore(
    (s) => s.hydrateAskShareForJob,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const expandProduct = useInlineProductStore((s) => s.expand);

  const [dropGlow, setDropGlow] = useState(false);
  const [railGlow, setRailGlow] = useState(false);
  const [lastDroppedId, setLastDroppedId] = useState<string | null>(null);
  const [heartedIds, setHeartedIds] = useState<Set<string>>(() => new Set());
  const [moodCount, setMoodCount] = useState<number | null>(null);
  const [twinEl, setTwinEl] = useState<HTMLDivElement | null>(null);
  const [scanScanning, setScanScanning] = useState(false);
  const [dressFlash, setDressFlash] = useState<string | null>(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [lookSaved, setLookSaved] = useState(false);
  const cart = useCartStore((s) => s.cart);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [inlineOk, setInlineOk] = useState(true);
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
  const [lookPainted, setLookPainted] = useState(false);
  const dressingLook =
    (status === "starting" || status === "processing") &&
    activeItems.length > 0;
  const scanLive = activeItems.length > 0 && (dressingLook || showResult);
  const dressingScan = dressingLook || (showResult && !lookPainted);
  const mirrorSrc =
    showResult && lookPainted && resultUrl
      ? resultUrl
      : peekUrl || avatarUrl;

  useEffect(() => {
    setLookPainted(false);
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
    warmAvatar();
  }, [warmAvatar]);

  useEffect(() => {
    if (!jobId) return;
    hydrateAskShareForJob(jobId);
  }, [jobId, hydrateAskShareForJob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (layout !== "inline") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setInlineOk(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [layout]);

  const dressItem = useCallback((id: string) => {
    const state = useTryOnDrawerStore.getState();
    const item = state.itemsById[id];
    if (!item) return;
    const replaced = state.activeIds
      .map((aid) => state.itemsById[aid])
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
    state.tryOnItem(id, { replaceSameType: true });
  }, []);

  const onDragStart = (event: DragEvent, id: string) => {
    event.dataTransfer.setData(FITTING_HANGER_MIME, id);
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "copyMove";
  };

  const onDropOnMirror = (event: DragEvent) => {
    event.preventDefault();
    setDropGlow(false);
    const store = useTryOnDrawerStore.getState();
    const payload = readFittingDrag(event.dataTransfer);
    if (payload?.kind === "item") {
      store.addToFittingRoom(payload.item);
      dressItem(payload.item.id);
      return;
    }
    if (payload?.kind === "look") {
      store.openLookTryOn({
        searchId: payload.searchId,
        lookId: payload.lookId,
        title: payload.title,
        items: payload.items,
      });
      return;
    }
    const id =
      event.dataTransfer.getData(FITTING_HANGER_MIME) ||
      event.dataTransfer.getData("text/plain");
    if (id) dressItem(id);
  };

  const onDropOnRail = (event: DragEvent) => {
    event.preventDefault();
    setRailGlow(false);
    const payload = readFittingDrag(event.dataTransfer);
    if (!payload) return;
    const store = useTryOnDrawerStore.getState();
    if (payload.kind === "item") {
      store.addToFittingRoom(payload.item);
      return;
    }
    store.addManyToFittingRoom(payload.items);
  };

  const lookInCart =
    activeItems.length > 0 &&
    activeItems
      .filter((item) => item.featuredVariant?.id && item.featuredVariant.checkoutUrl)
      .every((item) => cartContainsVariant(cart, item.featuredVariant!.id)) &&
    activeItems.some(
      (item) => item.featuredVariant?.id && item.featuredVariant.checkoutUrl,
    );

  useEffect(() => {
    setLookSaved(false);
    if (!jobId) return;
    let cancelled = false;
    void guestFetch("/api/tryon/moodboard", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          items?: Array<{ generationId: string }>;
        };
        if (
          !cancelled &&
          body.items?.some((item) => item.generationId === jobId)
        ) {
          setLookSaved(true);
        }
      })
      .catch(() => {
        /* saved state is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

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

  const addLookToMoodboard = () => {
    setActionHint(null);
    setMoodBusy(true);
    try {
      if (lookSaved) {
        if (jobId) sendFeedback(-1);
        setLookSaved(false);
        setHeartedIds((prev) => {
          const next = new Set(prev);
          for (const item of activeItems) next.delete(item.id);
          return next;
        });
        setMoodCount((n) =>
          typeof n === "number" ? Math.max(0, n - 1) : n,
        );
        setActionHint("Removed from moodboard");
        return;
      }
      if (jobId) sendFeedback(1);
      for (const item of activeItems) {
        setHeartedIds((prev) => new Set(prev).add(item.id));
      }
      setLookSaved(true);
      setMoodCount((n) =>
        typeof n === "number"
          ? n + Math.max(1, activeItems.length)
          : activeItems.length || 1,
      );
      setActionHint("Saved to your moodboard");
    } finally {
      setMoodBusy(false);
    }
  };

  const addLookToCart = async () => {
    if (lookInCart) {
      useCartStore.getState().setDrawerOpen(true);
      return;
    }
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

  if (layout === "inline" && !inlineOk) return null;

  const dressedLabel =
    activeItems.length === 0
      ? "Nothing on yet"
      : `${activeItems.length} piece${activeItems.length > 1 ? "s" : ""} on`;
  const overlay = layout === "overlay";

  const hangers = rackItems.length ? (
    <div className="shoop-fitgrid">
      {rackItems.map((item) => (
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
      ))}
    </div>
  ) : (
    <p className="shoop-rail-empty">
      {overlay
        ? "Hang a find from chat to try it on."
        : "Drag a find here to hang it. Drop it on the mirror to wear it."}
    </p>
  );

  const rail = (
    <section
      className={cn(
        overlay ? "shoop-croom__side" : "shoop-stage-col shoop-stage-col--rail",
        railGlow && "is-drop",
      )}
      onDragOver={(e) => {
        if (!hasFittingPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setRailGlow(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setRailGlow(false);
      }}
      onDrop={onDropOnRail}
    >
      <div className="shoop-croom__rail-block">
        {overlay ? null : (
          <header className="shoop-chead shoop-chead--stack">
            <div className="shoop-croom__mlbl">
              <span className="shoop-croom__dot" aria-hidden />
              <h2>The Fitting Room</h2>
            </div>
            <p className="shoop-chead__sub">
              {rackItems.length
                ? `${rackItems.length} piece${rackItems.length > 1 ? "s" : ""} waiting`
                : "empty"}
            </p>
          </header>
        )}
        <div className="shoop-hangrail">
          {previewLookTitle ? (
            <div className="shoop-lookgrp shoop-lookgrp--act">
              <i className="shoop-lookgrp__dot" aria-hidden />
              {previewLookTitle}
              <span className="shoop-lookgrp__bar" />
            </div>
          ) : null}
          {hangers}
        </div>
        {overlay ? null : (
          <div className="shoop-draghint">
            Drop a find here to hang it <b>· onto the mirror to wear it</b>
          </div>
        )}
      </div>

      {overlay ? null : (
        <MoodboardPeek
          localHearts={localHeartPreviews}
          count={moodCount}
          onNavigate={() => {}}
        />
      )}
    </section>
  );

  const mirror = (
    <section
      className={cn(
        overlay ? "shoop-croom__mirror" : "shoop-stage-col shoop-stage-col--mirror",
      )}
    >
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
                  window.setTimeout(() => close(), 0);
                }}
                aria-label="Back to chat"
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
              (scanScanning || dressingScan) && "shoop-twin--baking",
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
                  Your twin will show up here once you finish The Fitting.
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
                  Start your fitting
                </button>
              </div>
            )}

            {busy && avatarUrl ? (
              scanLive ? (
                <GarmentShadows
                  items={activeItems.length ? activeItems : rackItems}
                />
              ) : (
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
              )
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
            {scanLive ? (
              <StudyingScan
                key={`g-${renderGeneration}`}
                dressing={dressingScan}
                imageUrl={lookPainted ? resultUrl : null}
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
                saved={lookSaved}
                inCart={lookInCart}
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
    </section>
  );

  if (overlay) {
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
          {rail}
          {mirror}
        </div>
      </div>
    );
  }

  return (
    <>
      {mirror}
      {rail}
    </>
  );
}
