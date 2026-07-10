"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import { CLARIFICATION_OTHER_OPTION_ID } from "@/lib/ai-chat/types";

const PREVIEW_FALLBACK_MS = 3000;

function displayLabel(label: string): string {
  return label.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim() || label;
}

type ClarificationOptionCardProps = {
  optionId: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  previewQuery?: string;
  previewImages?: ClarificationOptionPreviewImage[];
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
  onToggle,
}: ClarificationOptionCardProps) {
  const hasPreviewImages = (previewImages?.length ?? 0) > 0;
  const expectsPreview = Boolean(
    (previewQuery?.trim() || hasPreviewImages) &&
      optionId !== CLARIFICATION_OTHER_OPTION_ID,
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
          <span className="shoop-explore-card__label">{displayLabel(label)}</span>
        </div>
      </div>
    </button>
  );
});
