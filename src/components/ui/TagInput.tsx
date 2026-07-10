"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function joinTags(tags: string[]): string {
  return tags.join(", ");
}

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: readonly string[];
  optional?: boolean;
  className?: string;
};

export function TagInput({
  label,
  value,
  onChange,
  placeholder = "Type and press Enter…",
  suggestions = [],
  optional = false,
  className,
}: Props) {
  const [draft, setDraft] = useState("");
  const tags = useMemo(() => parseTags(value), [value]);

  const addTag = useCallback(
    (raw: string) => {
      const next = raw.trim();
      if (!next) return;
      const lower = next.toLowerCase();
      if (tags.some((t) => t.toLowerCase() === lower)) return;
      onChange(joinTags([...tags, next]));
      setDraft("");
    },
    [onChange, tags],
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(joinTags(tags.filter((_, i) => i !== index)));
    },
    [onChange, tags],
  );

  const availableSuggestions = suggestions
    .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
    .slice(0, 8);

  return (
    <div className={cn("space-y-2", className)}>
      <span className="block text-sm font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-muted">Optional</span>
        ) : null}
      </span>

      <div className="rounded-xl border border-hairline bg-white px-3 py-2.5 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/15">
        {tags.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tags.map((tag, index) => (
              <span
                key={`${tag}-${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand-dark"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(index)}
                  className="rounded-full p-0.5 hover:bg-brand/10"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(draft);
            }
            if (e.key === "Backspace" && !draft && tags.length) {
              removeTag(tags.length - 1);
            }
          }}
          onBlur={() => addTag(draft)}
          placeholder={tags.length ? "Add another…" : placeholder}
          className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      {availableSuggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-subtle px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-brand/30 hover:bg-brand-tint/50 hover:text-brand-dark"
            >
              <Plus className="size-3" aria-hidden />
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
