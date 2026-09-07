"use client";

import { useEffect, useMemo, useState } from "react";
import { guestFetch } from "@/lib/client/guest-fetch";
import { cn } from "@/lib/ai-chat/cn";
import { NoListArt } from "@/components/onboarding/FittingNoListArt";
import {
  FittingKick,
  FittingNavRow,
  FittingPromise,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import {
  applyBrandTap,
  brandKey,
  communityBrand,
  findSeedBrand,
  searchSeedBrands,
  selectBrandsForUser,
  tileSrc,
  type CatalogBrand,
} from "@/lib/onboarding/brand-catalog";
import {
  applyNoListTap,
  isCardValue,
  isNoListOn,
  noListCardsFor,
} from "@/lib/onboarding/no-list-cards";
import type { LovesVetoesContext } from "@/lib/onboarding/loves-vetoes-suggest";

type Props = {
  context: LovesVetoesContext;
  brandLikes: string[];
  brandAvoids: string[];
  hardAvoids: string[];
  comfort: string[];
  onChangeBrandLikes: (values: string[]) => void;
  onChangeBrandAvoids: (values: string[]) => void;
  onChangeHardAvoids: (values: string[]) => void;
  onChangeComfort: (values: string[]) => void;
  onContinue?: () => void;
  busy?: boolean;
};

type BrandState = "love" | "never" | undefined;

function stateOf(name: string, likes: string[], avoids: string[]): BrandState {
  const key = brandKey(name);
  if (likes.some((b) => brandKey(b) === key)) return "love";
  if (avoids.some((b) => brandKey(b) === key)) return "never";
  return undefined;
}

function resolveNamed(name: string, community: CatalogBrand[]): CatalogBrand {
  return (
    findSeedBrand(name) ??
    community.find((b) => brandKey(b.name) === brandKey(name)) ??
    communityBrand(name)
  );
}

export function TasteLovesVetoesStep({
  context,
  brandLikes,
  brandAvoids,
  hardAvoids,
  comfort,
  onChangeBrandLikes,
  onChangeBrandAvoids,
  onChangeHardAvoids,
  onChangeComfort,
  onContinue,
  busy,
}: Props) {
  const [query, setQuery] = useState("");
  const [community, setCommunity] = useState<CatalogBrand[]>([]);
  const [ownDraft, setOwnDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    void guestFetch("/api/onboarding/brands")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { brands?: Array<{ name: string }> } | null) => {
        if (cancelled || !json?.brands) return;
        setCommunity(json.brands.map((b) => communityBrand(b.name)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const extras = useMemo(() => {
    const names = [...brandLikes, ...brandAvoids];
    const seen = new Set<string>();
    const out: CatalogBrand[] = [];
    for (const name of names) {
      const brand = resolveNamed(name, community);
      if (seen.has(brand.id)) continue;
      seen.add(brand.id);
      out.push(brand);
    }
    return out;
  }, [brandLikes, brandAvoids, community]);

  const grid = useMemo(
    () => selectBrandsForUser(context, extras),
    [context, extras],
  );

  const q = query.trim();
  const visible = useMemo(() => {
    if (!q) return grid;
    const hits = searchSeedBrands(q, 16);
    const seen = new Set(hits.map((b) => b.id));
    const extraHits: CatalogBrand[] = [];
    for (const b of [...grid, ...community]) {
      if (seen.has(b.id)) continue;
      const hay = brandKey(b.name);
      if (!hay.includes(q.toLowerCase())) continue;
      seen.add(b.id);
      extraHits.push(b);
    }
    return [...hits, ...extraHits];
  }, [q, grid, community]);

  const noCards = useMemo(() => noListCardsFor(context), [context]);
  const ownVetoes = hardAvoids.filter((v) => !isCardValue(v));

  const loveCount = brandLikes.length;
  const neverCount = brandAvoids.length;
  const vetoCount = neverCount + hardAvoids.length + comfort.length;

  const loveHint =
    loveCount === 0
      ? "nothing yet"
      : loveCount === 1
        ? "one is a start"
        : `${brandLikes.slice(0, 2).join(" and ")}${loveCount > 2 ? ` and ${loveCount - 2} more` : ""}`;

  const nextLabel =
    loveCount >= 1
      ? `Continue · ${loveCount} shops, ${vetoCount} vetoes`
      : "Continue without shops";

  function tapBrand(brand: CatalogBrand) {
    const next = applyBrandTap(brandLikes, brandAvoids, brand.name);
    onChangeBrandLikes(next.likes);
    onChangeBrandAvoids(next.avoids);
  }

  function loveBrand(name: string) {
    const key = brandKey(name);
    if (!brandLikes.some((b) => brandKey(b) === key)) {
      onChangeBrandLikes([...brandLikes, name]);
    }
    onChangeBrandAvoids(brandAvoids.filter((b) => brandKey(b) !== key));
  }

  async function submitSearch() {
    const name = query.trim();
    if (!name) return;
    const known =
      findSeedBrand(name) ??
      community.find((b) => brandKey(b.name) === brandKey(name));
    if (known) {
      loveBrand(known.name);
      setQuery("");
      return;
    }
    let saved = name;
    try {
      const res = await guestFetch("/api/onboarding/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as { brand?: { name: string } };
      if (json.brand?.name?.trim()) saved = json.brand.name.trim();
    } catch {
      /* still keep the typed name locally */
    }
    const card = communityBrand(saved);
    setCommunity((prev) =>
      prev.some((b) => b.id === card.id) ? prev : [card, ...prev],
    );
    loveBrand(saved);
    setQuery("");
  }

  function addOwnVeto() {
    const v = ownDraft.trim();
    if (!v) return;
    if (!hardAvoids.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChangeHardAvoids([...hardAvoids, v]);
    }
    setOwnDraft("");
  }

  const canAddQuery =
    Boolean(q) &&
    visible.length === 0 &&
    !findSeedBrand(q) &&
    !community.some((b) => brandKey(b.name) === brandKey(q));

  return (
    <section>
      <FittingKick>THE ONE THAT MATTERS MOST</FittingKick>
      <FittingTitle
        lines={[
          { text: "Where you shop," },
          { text: "and where you %%never would.%%", red: true },
        ]}
      />
      <FittingWhisper>
        Tap once for the ones you already trust.{" "}
        <b>Tap again for the ones you never want to see.</b> Two or three of
        each is plenty — I can work out the rest.
      </FittingWhisper>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <span className="flex items-center gap-2 rounded-[13px] border-[1.5px] border-[var(--fitting-line)] px-3.5 py-2.5 text-[12.5px]">
          <i className="grid size-[22px] place-items-center rounded-[7px] bg-[var(--fitting-g2)] text-[11px] font-extrabold not-italic text-[#B4B4BC]">
            ·
          </i>
          <b className="font-bold">Tap once</b>{" "}
          <em className="not-italic text-[var(--fitting-quiet)]">— I shop here</em>
        </span>
        <span className="flex items-center gap-2 rounded-[13px] border-[1.5px] border-[var(--fitting-line)] px-3.5 py-2.5 text-[12.5px]">
          <i className="grid size-[22px] place-items-center rounded-[7px] bg-[var(--fitting-ink)] text-[11px] font-extrabold not-italic text-white">
            ✓
          </i>
          <b className="font-bold">Tap again</b>{" "}
          <em className="not-italic text-[var(--fitting-quiet)]">— never show me this</em>
        </span>
        <span className="flex items-center gap-2 rounded-[13px] border-[1.5px] border-[var(--fitting-line)] px-3.5 py-2.5 text-[12.5px]">
          <i className="grid size-[22px] place-items-center rounded-[7px] bg-[var(--fitting-red)] text-[11px] font-extrabold not-italic text-white">
            ✕
          </i>
          <b className="font-bold">Once more</b>{" "}
          <em className="not-italic text-[var(--fitting-quiet)]">— clears it</em>
        </span>
      </div>

      <label className="mt-[22px] flex max-w-[440px] items-center gap-2 rounded-[14px] border-[1.5px] border-[var(--fitting-g3)] px-[15px] py-3 transition-[border-color] duration-150 focus-within:border-[var(--fitting-ink)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          className="size-4 shrink-0 text-[#B4B4BC]"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitSearch();
            }
          }}
          placeholder="Search, or type a shop I have missed"
          className="min-w-0 flex-1 border-0 bg-transparent text-[14.5px] text-[var(--fitting-ink)] outline-none placeholder:text-[#B4B4BC]"
        />
      </label>

      <div className="sticky top-0 z-10 mt-4 mb-1 flex flex-wrap items-center gap-2 border-b border-[var(--fitting-line)] bg-white/95 py-3.5 backdrop-blur-[10px]">
        <span className="flex items-center gap-2 rounded-full bg-[var(--fitting-ink)] px-3.5 py-2 text-[12.5px] font-semibold text-white">
          <b className="font-display text-[14px] font-black">{loveCount}</b> I
          shop here
        </span>
        <span className="flex items-center gap-2 rounded-full bg-[var(--fitting-red)] px-3.5 py-2 text-[12.5px] font-semibold text-white">
          <b className="font-display text-[14px] font-black">{neverCount}</b>{" "}
          never show me
        </span>
        <span className="flex items-center gap-2 rounded-full bg-[var(--fitting-g2)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fitting-quiet)]">
          {loveHint}
        </span>
        <span className="ml-auto text-[12px] text-[#B4B4BC]">
          tap a card twice to veto it
        </span>
      </div>

      <div className="fitting-brand-grid">
        {visible.map((brand) => (
          <BrandCard
            key={brand.id}
            brand={brand}
            state={stateOf(brand.name, brandLikes, brandAvoids)}
            onClick={() => tapBrand(brand)}
          />
        ))}
      </div>
      {canAddQuery ? (
        <button
          type="button"
          onClick={() => void submitSearch()}
          className="mt-3 rounded-[14px] border-[1.5px] border-dashed border-[var(--fitting-g3)] px-4 py-3 text-[13.5px] font-semibold text-[var(--fitting-ink)] hover:border-[var(--fitting-ink)]"
        >
          Add “{q}” as a shop I use
        </button>
      ) : null}

      <div className="mt-[52px] border-t border-[var(--fitting-line)] pt-[38px]">
        <FittingKick>AND THE THINGS, NOT THE SHOPS</FittingKick>
        <FittingTitle
          lines={[
            { text: "What you will" },
            { text: "%%never wear.%%", red: true },
          ]}
        />
        <FittingWhisper>
          Not what you are unsure about. <b>What is simply not happening.</b>
        </FittingWhisper>
        <FittingPromise>
          <b>This is a promise, not a preference.</b> Whatever you tap here, I
          will never show you again and I will never try to talk you into it.
          Not with a discount, not with a good reason, not ever.{" "}
          <b>You will not have to say it twice.</b>
        </FittingPromise>

        <div className="mt-[22px] grid grid-cols-2 gap-[11px] sm:grid-cols-3 lg:grid-cols-4">
          {noCards.map((card) => {
            const on = isNoListOn(card, comfort, hardAvoids);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  const next = applyNoListTap(card, comfort, hardAvoids);
                  onChangeComfort(next.comfort);
                  onChangeHardAvoids(next.hardAvoids);
                }}
                className={cn(
                  "overflow-hidden rounded-[15px] border-2 bg-white text-left transition duration-[180ms] hover:-translate-y-[3px]",
                  on
                    ? "border-[var(--fitting-red)] bg-[#FFF7F7]"
                    : "border-[var(--fitting-line)] hover:border-[#D0D0D6]",
                )}
              >
                <span
                  className={cn(
                    "relative block aspect-[1/0.92] overflow-hidden bg-[var(--fitting-g2)]",
                    on && "bg-[rgba(228,40,49,0.07)]",
                  )}
                >
                  <NoListArt id={card.id} />
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-0 z-[3] bg-[linear-gradient(135deg,transparent_calc(50%-1.5px),var(--fitting-red)_50%,transparent_calc(50%+1.5px))] transition-opacity duration-200",
                      on ? "opacity-100" : "opacity-0",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "block px-[11px] py-[10px] pb-3 text-center text-[12.5px] font-semibold leading-[1.3]",
                    on && "font-bold text-[var(--fitting-red)]",
                  )}
                >
                  {card.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <FittingKick>ANYTHING ELSE</FittingKick>
          <div className="mt-3 flex flex-wrap gap-2">
            {ownVetoes.map((v) => (
              <span
                key={v}
                className="flex items-center gap-2 rounded-xl border-[1.5px] border-[var(--fitting-red)] bg-[#FFF7F7] px-3.5 py-2 text-[13px] font-semibold text-[var(--fitting-red)]"
              >
                {v}
                <button
                  type="button"
                  onClick={() =>
                    onChangeHardAvoids(hardAvoids.filter((x) => x !== v))
                  }
                  className="text-[14px] text-[var(--fitting-red)] opacity-55 hover:opacity-100"
                  aria-label={`Remove ${v}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              value={ownDraft}
              onChange={(e) => setOwnDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOwnVeto();
                }
              }}
              placeholder="or type it…"
              className="w-[210px] rounded-xl border-[1.5px] border-dashed border-[var(--fitting-g3)] px-3.5 py-2.5 text-[13px] outline-none focus:border-solid focus:border-[var(--fitting-red)]"
            />
          </div>
        </div>
      </div>

      {onContinue ? (
        <FittingNavRow onNext={onContinue} nextLabel={nextLabel} busy={busy} />
      ) : null}
    </section>
  );
}

function BrandCard({
  brand,
  state,
  onClick,
}: {
  brand: CatalogBrand;
  state: BrandState;
  onClick: () => void;
}) {
  const src = tileSrc(brand);
  const long = brand.name.length > 12;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "fitting-brand-card mb-3 block w-full overflow-hidden rounded-2xl transition duration-200 hover:-translate-y-[3px]",
        state === "love" &&
          "shadow-[inset_0_0_0_3px_var(--fitting-ink)]",
        state === "never" &&
          "never shadow-[inset_0_0_0_3px_var(--fitting-red)]",
      )}
    >
      <span className="relative block w-full">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="fitting-brand-im block w-full" />
        ) : (
          <svg
            className="fitting-brand-im block w-full"
            viewBox="0 0 300 250"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id={`bg-${brand.id}`} x1="0" y1="0" x2="0.8" y2="1">
                <stop offset="0" stopColor={brand.c1} />
                <stop offset="1" stopColor={brand.c2} />
              </linearGradient>
            </defs>
            <rect width="300" height="250" fill={`url(#bg-${brand.id})`} />
          </svg>
        )}
        <span
          className={cn(
            "absolute inset-0 z-[2]",
            state === "never"
              ? "bg-[linear-gradient(180deg,rgba(228,40,49,.28),rgba(228,40,49,.42))]"
              : src
                ? "bg-transparent"
                : "bg-[linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.34))]",
          )}
        />
        {!src ? (
          <span
            className={cn(
              "absolute inset-x-0 top-1/2 z-[3] -translate-y-1/2 px-3 text-center font-display font-black tracking-[-0.02em] text-white [text-shadow:0_2px_16px_rgba(0,0,0,.5)]",
              long ? "text-[15px]" : "text-[19px]",
              state === "never" && "opacity-75",
            )}
          >
            {brand.name}
          </span>
        ) : null}
        {state ? (
          <span
            className={cn(
              "absolute top-2.5 right-2.5 z-[5] grid size-[26px] place-items-center rounded-[9px] text-[12px] font-extrabold text-white",
              state === "never" ? "bg-[var(--fitting-red)]" : "bg-[var(--fitting-ink)]",
            )}
          >
            {state === "never" ? "✕" : "✓"}
          </span>
        ) : null}
      </span>
    </button>
  );
}
