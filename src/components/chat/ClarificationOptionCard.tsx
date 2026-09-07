"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import { CLARIFICATION_OTHER_OPTION_ID } from "@/lib/ai-chat/types";

import { paletteFallbackForLabel } from "@/lib/ai-chat/clarification-palette-fallback";

const PREVIEW_FALLBACK_MS = 3000;

function displayLabel(label: string): string {
  return label.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim() || label;
}

function splitLabel(label: string): { title: string; subtitle?: string } {
  const clean = displayLabel(label);
  const parts = clean.split(/\s*[—–\n]\s*/);
  if (parts.length >= 2 && parts[0]!.trim().length > 0 && parts[0]!.length < 48) {
    return {
      title: parts[0]!.trim(),
      subtitle: parts.slice(1).join(" — ").trim() || undefined,
    };
  }
  // "TITLE soft description" where TITLE is short caps-ish head
  const m = clean.match(/^(.{2,28}?)\s{2,}(.+)$/);
  if (m) return { title: m[1]!.trim(), subtitle: m[2]!.trim() };
  return { title: clean };
}

function dotsForLabel(label: string, paletteColors?: string[]): string[] {
  if (paletteColors && paletteColors.length >= 3) {
    return paletteColors.slice(0, 4);
  }
  return paletteFallbackForLabel(label);
}

type ClarificationOptionCardProps = {
  optionId: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  previewQuery?: string;
  previewImages?: ClarificationOptionPreviewImage[];
  /** LLM-resolved hex palette for color chips */
  paletteColors?: string[];
  /** Color / palette questions → swatch tiles even when previewQuery exists */
  preferPalette?: boolean;
  onToggle: () => void;
};

function HeroImage({
  image,
  onFailed,
  onLoaded,
  visible,
}: {
  image: ClarificationOptionPreviewImage;
  onFailed: () => void;
  onLoaded: () => void;
  visible: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- merchant CDN URLs
    <img
      src={image.url}
      alt={image.title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={cn(
        "shoop-explore-card__img",
        visible ? "opacity-100" : "opacity-0",
      )}
      onLoad={onLoaded}
      onError={onFailed}
    />
  );
}

export const ClarificationOptionCard = memo(function ClarificationOptionCard({
  optionId,
  label,
  selected,
  disabled,
  previewQuery,
  previewImages,
  paletteColors,
  preferPalette = false,
  onToggle,
}: ClarificationOptionCardProps) {
  const hasPreviewImages = (previewImages?.length ?? 0) > 0;
  const isOther = optionId === CLARIFICATION_OTHER_OPTION_ID;
  const isSurprise = /surprise/i.test(label) || optionId === "surprise_me";
  const looksPaletteLabel =
    preferPalette ||
    /neutral|earth|cool|warm|tone|palette|color/i.test(label);
  const expectsPreview = Boolean(
    (previewQuery?.trim() || hasPreviewImages) &&
      !isOther &&
      !isSurprise &&
      !preferPalette,
  );
  const [imageIndex, setImageIndex] = useState(0);
  const heroImage = previewImages?.[imageIndex];
  const hasImages = Boolean(heroImage);
  const [imageFailed, setImageFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [fallbackToChip, setFallbackToChip] = useState(false);

  useEffect(() => {
    setImageIndex(0);
    setImageFailed(false);
    setHydrated(false);
  }, [previewImages]);

  useEffect(() => {
    if (!hasImages || imageFailed) {
      setHydrated(false);
      return;
    }
    const id = window.requestAnimationFrame(() => setHydrated(true));
    return () => window.cancelAnimationFrame(id);
  }, [hasImages, imageFailed, heroImage?.url]);

  useEffect(() => {
    if (!expectsPreview || hasImages) return;
    const timer = window.setTimeout(() => {
      setFallbackToChip(true);
    }, PREVIEW_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [expectsPreview, hasImages, previewQuery]);

  const showVisualCard = useMemo(() => {
    if (!expectsPreview) return false;
    if (fallbackToChip && !hasImages) return false;
    if (imageFailed && !hasImages) return false;
    return true;
  }, [expectsPreview, fallbackToChip, hasImages, imageFailed]);

  const { title, subtitle } = splitLabel(label);

  const handleImageError = () => {
    const nextIndex = imageIndex + 1;
    if (previewImages && nextIndex < previewImages.length) {
      setImageIndex(nextIndex);
      setImageFailed(false);
      setHydrated(false);
      return;
    }
    setImageFailed(true);
    if (!hasPreviewImages) {
      setFallbackToChip(true);
    }
  };

  if (isOther) return null;

  if (isSurprise || (!showVisualCard && looksPaletteLabel) || preferPalette) {
    const surprise = isSurprise;
    const { title: t, subtitle: s } = splitLabel(label);
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onToggle}
        className={cn(
          "shoop-paltile",
          surprise && "shoop-paltile--surprise",
          selected && "shoop-paltile--on",
        )}
      >
        <span className="shoop-paltile__title">
          {surprise ? t || "Surprise me" : t}
        </span>
        {s || surprise ? (
          <span className="shoop-paltile__body">
            {s ||
              (surprise
                ? "I know your palette… trust the stylist"
                : null)}
          </span>
        ) : null}
        {!surprise ? (
          <div className="shoop-paltile__dots" aria-hidden>
            {dotsForLabel(label, paletteColors).map((c, i) => (
              <span key={`${c}-${i}`} style={{ background: c }} />
            ))}
          </div>
        ) : null}
      </button>
    );
  }

  if (!showVisualCard) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onToggle}
        className={
          selected ? "shoop-quiz-chip shoop-quiz-chip--active" : "shoop-quiz-chip"
        }
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "shoop-explore-card group/button",
        selected && "shoop-explore-card--selected",
        disabled && "shoop-explore-card--disabled",
      )}
    >
      <div className="shoop-explore-card__media">
        <div className="shoop-explore-card__image-wrap">
          {!hasImages || imageFailed ? (
            <div className="shoop-explore-card__shimmer" aria-hidden />
          ) : (
            <HeroImage
              image={heroImage!}
              visible={hydrated && !imageFailed}
              onLoaded={() => setHydrated(true)}
              onFailed={handleImageError}
            />
          )}
        </div>

        {selected ? (
          <span className="shoop-explore-card__selected-badge" aria-hidden>
            <Check className="size-3.5" strokeWidth={2.5} />
          </span>
        ) : null}

        <div className="shoop-explore-card__caption">
          <span className="shoop-explore-card__label">{title}</span>
          {subtitle ? (
            <span className="shoop-explore-card__sub">{subtitle}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
});
