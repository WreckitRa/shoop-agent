"use client";

import { X } from "lucide-react";
import { resolveHomeCategories } from "@/lib/categories/home-categories";

type SelectedCategoryChipsProps = {
  selectedCategories: string[];
  onRemove: (name: string) => void;
};

export function SelectedCategoryChips({
  selectedCategories,
  onRemove,
}: SelectedCategoryChipsProps) {
  const resolved = resolveHomeCategories(selectedCategories);
  if (!resolved.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {resolved.map((cat) => (
        <button
          key={cat.name}
          type="button"
          aria-label={`Remove ${cat.name} category`}
          className="shoop-cat-chip"
          style={{ background: cat.fallbackBg }}
          onClick={() => onRemove(cat.name)}
        >
          <span>{cat.name}</span>
          <X
            className="shoop-cat-chip-x size-3 shrink-0"
            strokeWidth={2}
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}
