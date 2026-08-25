"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cartItemCount, useCartStore } from "@/components/cart/cart-store";
import { MoodboardView } from "@/components/moodboard/MoodboardView";
import { HoldView } from "@/components/moodboard/HoldView";
import { CartPageView } from "@/components/moodboard/CartPageView";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useClientIdentityScopeKey } from "@/lib/client/identity-sync";
import { useGuestMode } from "@/hooks/useGuestMode";
import { cn } from "@/lib/ai-chat/cn";

export type DecideTab = "board" | "hold" | "cart";

const TAB_META: Record<
  DecideTab,
  { label: string; lede: string; sig?: boolean }
> = {
  board: {
    label: "My moodboard",
    lede: "everything you didn't walk away from... no clock, no pressure",
  },
  hold: {
    label: "The Hold",
    lede: "Coming soon — when you say yes, I'll watch price, size, and delivery for seven days",
    sig: true,
  },
  cart: {
    label: "My cart",
    lede: "three stores, one checkout, one payment",
  },
};

function parseTab(raw: string | null): DecideTab {
  if (raw === "hold" || raw === "cart" || raw === "board") return raw;
  return "board";
}

export function DecideHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const { isGuest } = useGuestMode();
  const identityScope = useClientIdentityScopeKey();

  const cart = useCartStore((s) => s.cart);
  const refreshCart = useCartStore((s) => s.refresh);
  const cartCount = cartItemCount(cart);

  const [boardCount, setBoardCount] = useState(0);

  useEffect(() => {
    void refreshCart();
  }, [refreshCart]);

  useEffect(() => {
    if (isGuest) {
      setBoardCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await guestFetch("/api/tryon/moodboard", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { items?: unknown[] };
        if (!cancelled) setBoardCount(body.items?.length ?? 0);
      } catch {
        /* count is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest, tab, identityScope]);

  const setTab = useCallback(
    (next: DecideTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "board") params.delete("tab");
      else params.set("tab", next);
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const counts = useMemo(
    () => ({
      board: boardCount,
      hold: 0,
      cart: cartCount,
    }),
    [boardCount, cartCount],
  );

  return (
    <div className="shoop-decide">
      <header className="shoop-decide__top">
        <div className="shoop-decide__brand">
          <span className="shoop-decide__dot" aria-hidden />
          <span>Shoop</span>
        </div>
        <nav className="shoop-decide__tabs" aria-label="Decide">
          {(Object.keys(TAB_META) as DecideTab[]).map((key) => {
            const meta = TAB_META[key];
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                className={cn("shoop-decide__tab", selected && "is-sel")}
                aria-current={selected ? "page" : undefined}
                onClick={() => setTab(key)}
              >
                <h2>{meta.label}</h2>
                {key === "hold" ? (
                  <span className="shoop-decide__tab-soon">Soon</span>
                ) : (
                  <span className="shoop-decide__tab-n">{counts[key]}</span>
                )}
                {meta.sig && !selected ? (
                  <span className="shoop-decide__tab-sig" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="shoop-decide__wrap">
        <p className="shoop-decide__lede">{TAB_META[tab].lede}</p>

        <div
          className={cn("shoop-decide__view", tab === "board" && "is-on")}
          hidden={tab !== "board"}
        >
          {tab === "board" ? (
            <MoodboardView
              embedded
              onCountChange={setBoardCount}
              onAskHold={() => setTab("hold")}
            />
          ) : null}
        </div>
        <div
          className={cn("shoop-decide__view", tab === "hold" && "is-on")}
          hidden={tab !== "hold"}
        >
          {tab === "hold" ? (
            <HoldView onGoBoard={() => setTab("board")} />
          ) : null}
        </div>
        <div
          className={cn("shoop-decide__view", tab === "cart" && "is-on")}
          hidden={tab !== "cart"}
        >
          {tab === "cart" ? <CartPageView /> : null}
        </div>
      </div>
    </div>
  );
}
