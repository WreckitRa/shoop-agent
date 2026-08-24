"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import type { BuildKey, SilhouetteForm } from "./types";

type Props = {
  preferredName: string;
  wornLabels: string[];
  stealLabels: string[];
  leanLabel: string;
  form: SilhouetteForm;
  build: BuildKey | null;
  vetoCount: number;
  developPct: number;
  /** Trusted Circle first names from onboarding. */
  circleNames?: string[];
  /** FASHN dress of one worn pick onto the twin. */
  dressStatus?: "idle" | "dressing" | "ready" | "error";
  dressStyleLabel?: string | null;
  busy?: boolean;
  onMeetTwin: () => void;
  onShare?: (selectedCircle: string[]) => void;
  shareCopied?: boolean;
};

const LEAN_TXT: Record<string, string> = {
  Parisian: "effortless, thrown-on polish",
  Minimal: "clean lines and quiet confidence",
  Bold: "statement pieces that own the room",
};

const BUILD_TXT: Record<BuildKey, string> = {
  slim: "your frame carries drape and layering beautifully",
  average:
    "nearly every cut works on you... precise fit is your superpower",
  athletic: "structure and taper show your shape... boxy hides it",
  broad: "strong shoulders love clean lines and hate cling",
  plus: "drape, structure and the right rise do the work... cling never will",
};

export function FittingVerdictStep({
  preferredName,
  wornLabels,
  stealLabels,
  leanLabel,
  form,
  build,
  vetoCount,
  developPct,
  circleNames = [],
  dressStatus = "idle",
  dressStyleLabel = null,
  busy,
  onMeetTwin,
  onShare,
  shareCopied,
}: Props) {
  const cleanedCircle = circleNames.map((n) => n.trim()).filter(Boolean);
  const cleanedKey = cleanedCircle.join("\0");
  const [selectedCircle, setSelectedCircle] = useState<string[]>(cleanedCircle);

  useEffect(() => {
    setSelectedCircle(cleanedCircle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when names change
  }, [cleanedKey]);

  const first =
    preferredName.trim().charAt(0).toUpperCase() +
    preferredName.trim().slice(1).toLowerCase();
  const leanKey = leanLabel || "Minimal";
  const leanTxt =
    LEAN_TXT[leanKey] ??
    LEAN_TXT[leanKey.charAt(0).toUpperCase() + leanKey.slice(1).toLowerCase()] ??
    "a mix all your own";
  const buildTxt = build
    ? BUILD_TXT[build]
    : "we'll fine-tune the cut as we shop together";
  const formTip =
    form === "f"
      ? "Waist definition is your friend... let pieces follow it."
      : form === "m"
        ? "Let the shoulder line lead... everything hangs from there."
        : "Balance over rules... we fit the body you have, not a template.";

  const gap =
    stealLabels[0] &&
    wornLabels[0] &&
    stealLabels[0] !== wornLabels[0]
      ? `You live in <b>${wornLabels.join(" + ") || "your comfort zone"}</b> but you're drawn to <b>${stealLabels.join(" + ")}</b>... that gap is exactly where I'll push you, one piece at a time.`
      : "Your reality and your wishlist already agree... my job is to sharpen it.";

  function toggleCircle(name: string) {
    setSelectedCircle((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  return (
    <section>
      <FittingKick>THE VERDICT · FROM THE FITTING</FittingKick>
      <FittingTitle
        lines={[
          {
            text: first
              ? `Alright ${first}...`
              : "Alright...",
          },
          { text: "here's what I %%see.%%", red: true },
        ]}
      />

      <div className="mt-2 max-w-[600px] rounded-[20px] bg-[var(--fitting-ink)] px-7 py-[26px] text-white shadow-[0_26px_54px_-22px_rgba(14,14,17,0.55)]">
        <div className="text-[10.5px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
          WHAT YOU LOVE
        </div>
        <p className="mt-1.5 text-sm leading-[1.65] text-[#E8E8EE] [&_b]:text-white">
          {wornLabels.length ? (
            <>
              <b>{wornLabels.join(" · ")}</b>
              {"... "}
            </>
          ) : null}
          you lean toward <b>{leanTxt}</b>
          {vetoCount > 0 ? (
            <>
              , and you know your nos:{" "}
              <b>{vetoCount} hard vetoes</b>, sacred and kept.
            </>
          ) : (
            "."
          )}
        </p>

        <div className="mt-4 text-[10.5px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
          WHAT SUITS YOU
        </div>
        <p className="mt-1.5 text-sm leading-[1.65] text-[#E8E8EE] [&_b]:text-white">
          {buildTxt.charAt(0).toUpperCase() + buildTxt.slice(1)}. {formTip}
        </p>

        <div className="mt-4 text-[10.5px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
          WORTH CONSIDERING
        </div>
        <p
          className="mt-1.5 text-sm leading-[1.65] text-[#E8E8EE] [&_b]:text-white"
          dangerouslySetInnerHTML={{ __html: gap }}
        />

        <div className="mt-4 border-t border-white/12 pt-3.5">
          {cleanedCircle.length ? (
            <>
              <div className="mb-2.5 text-[10.5px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
                SEND IT TO YOUR TRUSTED CIRCLE
              </div>
              <div className="flex flex-wrap">
                {cleanedCircle.map((name) => {
                  const on = selectedCircle.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleCircle(name)}
                      className={cn(
                        "mb-1.5 mr-1.5 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-white/30 py-1.5 pl-1.5 pr-3.5 text-[12.5px] font-bold text-white transition-all",
                        on && "border-white bg-white text-[var(--fitting-ink)]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-[22px] place-items-center rounded-full bg-white/16 text-[10px] font-extrabold",
                          on && "bg-[var(--fitting-ink)] text-white",
                        )}
                      >
                        {name.charAt(0).toUpperCase()}
                      </span>
                      {name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-[#B9B9C2]">
                They vote in one tap. No signup, no app. Your verdict stays
                sealed until they do.
              </p>
            </>
          ) : (
            <>
              <div className="mb-2.5 text-[10.5px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
                SEND IT TO SOMEONE
              </div>
              <p className="text-[13px] text-[#D6D6DE]">
                You skipped the circle... add a name and this becomes one tap.
              </p>
            </>
          )}
        </div>

        <div className="mt-[18px] flex flex-wrap items-center gap-3 border-t border-white/12 pt-3.5">
          <FittingCta onClick={onMeetTwin} disabled={busy}>
            {busy ? "Opening…" : "Meet your twin in the Mirror"}
          </FittingCta>
          {onShare ? (
            <button
              type="button"
              onClick={() => onShare(selectedCircle)}
              className="h-[46px] rounded-xl border-[1.5px] border-white bg-transparent px-5 font-display text-[13px] font-extrabold text-white transition hover:bg-white hover:text-[var(--fitting-ink)]"
            >
              {shareCopied
                ? "Copied ✓"
                : cleanedCircle.length && selectedCircle.length
                  ? "Ask my circle"
                  : "Share my verdict"}
            </button>
          ) : null}
        </div>
      </div>

      <FittingWhisper>
        {dressStatus === "dressing" ? (
          <>
            Shoop is putting{" "}
            <b>{dressStyleLabel ?? "your worn look"}</b> on your twin right
            now... {developPct}% and counting.
          </>
        ) : dressStatus === "ready" ? (
          <>
            {developPct}% · dressed in{" "}
            <b>{dressStyleLabel ?? "your worn look"}</b>. Open the Mirror — the
            foil lands with the fit.
          </>
        ) : (
          <>
            {developPct}% developed... the Mirror brings the fit, the mint
            brings the foil.{" "}
            <b>First-edition serials are still three digits.</b>
          </>
        )}
      </FittingWhisper>
    </section>
  );
}
