"use client";

import { Check } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { HOME_CATEGORIES, type HomeCategory } from "@/lib/categories/home-categories";
import {
  categoryMarqueeCopies,
  categoryMarqueeDurationS,
  resolveCategoryMarqueeExperience,
  type CategoryMarqueeExperience,
} from "@/lib/categories/marquee-experience";

type CategoryMarqueeProps = {
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
};

export function CategoryMarquee({
  selectedCategories,
  onToggleCategory,
}: CategoryMarqueeProps) {
  const [experience, setExperience] =
    useState<CategoryMarqueeExperience>("compact");

  useEffect(() => {
    const sync = () =>
      setExperience(resolveCategoryMarqueeExperience());

    sync();

    const queries = [
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(max-width: 767px)"),
      window.matchMedia("(hover: none) and (pointer: coarse)"),
    ];

    for (const query of queries) {
      query.addEventListener("change", sync);
    }

    return () => {
      for (const query of queries) {
        query.removeEventListener("change", sync);
      }
    };
  }, []);

  const tiles = useMemo(() => {
    const copies = categoryMarqueeCopies(experience);
    return Array.from({ length: copies }, () => HOME_CATEGORIES).flat();
  }, [experience]);

  if (experience === "fill") {
    return (
      <FillCategoryRow
        tiles={tiles}
        selectedCategories={selectedCategories}
        onToggleCategory={onToggleCategory}
      />
    );
  }

  if (experience === "compact") {
    return (
      <CssCategoryMarquee
        tiles={tiles}
        durationS={categoryMarqueeDurationS("compact")}
        selectedCategories={selectedCategories}
        onToggleCategory={onToggleCategory}
      />
    );
  }

  return (
    <LensCategoryMarquee
      tiles={tiles}
      durationS={categoryMarqueeDurationS("marquee")}
      selectedCategories={selectedCategories}
      onToggleCategory={onToggleCategory}
    />
  );
}

type StripProps = {
  tiles: HomeCategory[];
  durationS?: number;
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
};

function FillCategoryRow({
  tiles,
  selectedCategories,
  onToggleCategory,
}: StripProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const markImageFailed = useCallback((url: string) => {
    setFailedImages((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  return (
    <div
      className="shoop-category-marquee shoop-category-marquee--fill"
      role="region"
      aria-label="Browse shopping categories"
    >
      <div className="shoop-category-fill-track">
        {tiles.map((cat, index) => (
          <CategoryTile
            key={`${cat.name}-${index}`}
            category={cat}
            selected={selectedCategories.includes(cat.name)}
            showFallback={failedImages.has(cat.imageUrl)}
            fill
            eagerImage
            onImageError={() => markImageFailed(cat.imageUrl)}
            onClick={() => onToggleCategory(cat.name)}
          />
        ))}
      </div>
    </div>
  );
}

function CssCategoryMarquee({
  tiles,
  durationS,
  selectedCategories,
  onToggleCategory,
}: StripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const markImageFailed = useCallback((url: string) => {
    setFailedImages((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const setPaused = (paused: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.animationPlayState = paused ? "paused" : "running";
  };

  return (
    <div
      className="shoop-category-marquee shoop-category-marquee--animated"
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onTouchCancel={() => setPaused(false)}
    >
      <div
        ref={trackRef}
        className="shoop-marquee-track"
        style={
          {
            "--marquee-duration": `${durationS ?? 72}s`,
          } as CSSProperties
        }
      >
        {tiles.map((cat, index) => (
          <CategoryTile
            key={`${cat.name}-${index}`}
            category={cat}
            selected={selectedCategories.includes(cat.name)}
            showFallback={failedImages.has(cat.imageUrl)}
            eagerImage={index < 12}
            onImageError={() => markImageFailed(cat.imageUrl)}
            onClick={() => onToggleCategory(cat.name)}
          />
        ))}
      </div>
    </div>
  );
}

function LensCategoryMarquee({
  tiles,
  durationS,
  selectedCategories,
  onToggleCategory,
}: StripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const visibleRef = useRef(true);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const markImageFailed = useCallback((url: string) => {
    setFailedImages((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    const stopLoop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const resetTiles = () => {
      for (const tile of tileRefs.current) {
        if (!tile) continue;
        tile.style.transform = "";
        tile.style.opacity = "";
        tile.style.zIndex = "";
      }
    };

    const setPaused = (paused: boolean) => {
      track.style.animationPlayState = paused ? "paused" : "running";
    };

    const loop = () => {
      if (!visibleRef.current || document.hidden) {
        rafRef.current = null;
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const main = container.closest("main");
      const focusRect = main?.getBoundingClientRect() ?? containerRect;
      const focusCenter = focusRect.left + focusRect.width / 2;
      const peakRadius = focusRect.width * 0.18;

      for (const tile of tileRefs.current) {
        if (!tile) continue;

        const rect = tile.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const distance = Math.abs(centerX - focusCenter);
        const normalized = Math.min(distance / peakRadius, 1);
        const t = Math.pow((Math.cos(normalized * Math.PI) + 1) / 2, 1.6);

        const scale = 0.82 + t * (1.44 - 0.82);
        const liftY = -7 * t;
        const opacity = 0.45 + t * (1 - 0.45);
        const pushX =
          centerX < focusCenter
            ? -26 * (1 - t)
            : centerX > focusCenter
              ? 26 * (1 - t)
              : 0;

        tile.style.transform = `translate3d(${pushX}px, ${liftY}px, 0) scale(${scale})`;
        tile.style.opacity = String(opacity);
        tile.style.zIndex = String(Math.round(t * 10));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(loop);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? true;
        if (!visibleRef.current) {
          stopLoop();
          setPaused(true);
          resetTiles();
        } else {
          setPaused(false);
          startLoop();
        }
      },
      { threshold: 0.05 },
    );
    observer.observe(container);

    const onVisibility = () => {
      if (document.hidden) {
        stopLoop();
        setPaused(true);
        resetTiles();
      } else if (visibleRef.current) {
        setPaused(false);
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    startLoop();

    return () => {
      stopLoop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      resetTiles();
    };
  }, [tiles.length]);

  const setPaused = (paused: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.animationPlayState = paused ? "paused" : "running";
  };

  return (
    <div
      ref={containerRef}
      className="shoop-category-marquee shoop-category-marquee--animated"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div
        ref={trackRef}
        className="shoop-marquee-track"
        style={
          {
            "--marquee-duration": `${durationS ?? 96}s`,
          } as CSSProperties
        }
      >
        {tiles.map((cat, index) => {
          const selected = selectedCategories.includes(cat.name);
          const showFallback = failedImages.has(cat.imageUrl);

          return (
            <CategoryTile
              key={`${cat.name}-${index}`}
              ref={(el) => {
                tileRefs.current[index] = el;
              }}
              category={cat}
              selected={selected}
              showFallback={showFallback}
              onImageError={() => markImageFailed(cat.imageUrl)}
              onClick={() => onToggleCategory(cat.name)}
            />
          );
        })}
      </div>
    </div>
  );
}

type CategoryTileProps = {
  category: HomeCategory;
  selected: boolean;
  showFallback: boolean;
  fill?: boolean;
  eagerImage?: boolean;
  onImageError: () => void;
  onClick: () => void;
};

const CategoryTile = forwardRef<HTMLButtonElement, CategoryTileProps>(
  function CategoryTile(
    {
      category,
      selected,
      showFallback,
      fill = false,
      eagerImage = false,
      onImageError,
      onClick,
    },
    ref,
  ) {
    const Icon = category.icon;
    const action = selected ? "Remove" : "Add";

    return (
      <button
        ref={ref}
        type="button"
        data-tile="true"
        aria-label={`${action} ${category.name} category`}
        aria-pressed={selected}
        className={`shoop-marquee-tile${fill ? " shoop-marquee-tile--fill" : ""}`}
        style={{ background: category.fallbackBg }}
        onClick={onClick}
      >
        {!showFallback ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.imageUrl}
            alt=""
            loading={eagerImage ? "eager" : "lazy"}
            decoding="async"
            className="shoop-marquee-tile-image"
            onError={onImageError}
          />
        ) : (
          <span className="shoop-marquee-tile-fallback" aria-hidden>
            <Icon strokeWidth={1.75} className="size-7 text-ink/70" />
          </span>
        )}
        <div className="shoop-marquee-tile-gradient" aria-hidden />
        <span className="shoop-marquee-tile-label">{category.name}</span>
        {selected ? (
          <span className="shoop-marquee-tile-check" aria-hidden>
            <Check strokeWidth={3} className="size-[11px] text-white" />
          </span>
        ) : null}
      </button>
    );
  },
);
