/**
 * Replacement for the question-rendering half of FashionRouterControls.tsx
 * plus a new NextStepChips block for the results turn.
 *
 * Behavior contract:
 *  - known_summary renders as a quiet line ABOVE the reply (the "I know you"
 *    moment), never as a question.
 *  - why renders as small muted text under a consult question.
 *  - Blocking questions show first, consult questions after, separated by a
 *    hairline. Blocking = "so it fits"; consult = "so it's right".
 *  - Chip taps post the label as a plain user message (unchanged) — the
 *    router LLM absorbs meaning. This component never encodes meaning.
 *  - escape_chip renders once, full-width, at the bottom of a consult turn.
 *    Tapping it posts its label and marks all consult questions answered.
 *  - Multi-select questions submit as "label1, label2".
 *  - Other / Skip added as before (Skip only on person_name).
 */

import { useState } from "react";

type QuickOption = string | { label: string; preview_query: string; image_url?: string };
export interface ConsultQuestion {
  gap: string;
  kind: "blocking" | "consult";
  text: string;
  why?: string;
  quick_options: QuickOption[];
  allow_multiple?: boolean;
}
export interface ConsultPayload {
  reply: string;
  known_summary?: string;
  questions: ConsultQuestion[];
  escape_chip?: string;
}

const label = (o: QuickOption) => (typeof o === "string" ? o : o.label);

export function FashionConsultation({
  payload,
  onSend,
}: {
  payload: ConsultPayload;
  onSend: (text: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const blocking = payload.questions.filter((q) => q.kind === "blocking");
  const consult = payload.questions.filter((q) => q.kind === "consult");

  const submitSingle = (q: ConsultQuestion, o: QuickOption) => onSend(label(o));
  const toggleMulti = (q: ConsultQuestion, o: QuickOption) =>
    setPicked((p) => {
      const cur = p[q.gap] ?? [];
      const l = label(o);
      return { ...p, [q.gap]: cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l] };
    });
  const submitMulti = (q: ConsultQuestion) => {
    const v = picked[q.gap];
    if (v?.length) onSend(v.join(", "));
  };

  const renderQuestion = (q: ConsultQuestion) => (
    <div key={q.gap} className="space-y-2">
      <div className="text-sm font-medium">{q.text}</div>
      {q.why && q.kind === "consult" && (
        <div className="text-xs text-muted-foreground">— {q.why}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {q.quick_options.map((o) => {
          const l = label(o);
          const img = typeof o === "object" ? o.image_url : undefined;
          const active = picked[q.gap]?.includes(l);
          return (
            <button
              key={l}
              className={`rounded-full border px-3 py-1 text-sm ${active ? "bg-foreground text-background" : ""} ${img ? "flex items-center gap-2" : ""}`}
              onClick={() => (q.allow_multiple ? toggleMulti(q, o) : submitSingle(q, o))}
            >
              {img && <img src={img} alt="" className="h-6 w-6 rounded object-cover" />}
              {l}
            </button>
          );
        })}
        {q.gap === "person_name" ? (
          <button className="rounded-full border px-3 py-1 text-sm opacity-70" onClick={() => onSend("Skip")}>
            Skip
          </button>
        ) : (
          <OtherChip onSend={onSend} />
        )}
        {q.allow_multiple && (
          <button className="rounded-full bg-foreground px-3 py-1 text-sm text-background" onClick={() => submitMulti(q)}>
            Done
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {payload.known_summary && (
        <div className="text-xs italic text-muted-foreground">{payload.known_summary}</div>
      )}
      <div className="text-sm">{payload.reply}</div>
      {blocking.length > 0 && <div className="space-y-4">{blocking.map(renderQuestion)}</div>}
      {blocking.length > 0 && consult.length > 0 && <hr className="opacity-30" />}
      {consult.length > 0 && <div className="space-y-4">{consult.map(renderQuestion)}</div>}
      {payload.escape_chip && consult.length > 0 && (
        <button
          className="w-full rounded-lg border border-dashed py-2 text-sm"
          onClick={() => onSend(payload.escape_chip!)}
        >
          {payload.escape_chip}
        </button>
      )}
    </div>
  );
}

function OtherChip({ onSend }: { onSend: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (!open)
    return (
      <button className="rounded-full border px-3 py-1 text-sm opacity-70" onClick={() => setOpen(true)}>
        Other
      </button>
    );
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSend(v.trim());
      }}
    >
      <input className="rounded border px-2 py-1 text-sm" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <button className="text-sm">Send</button>
    </form>
  );
}

/** Rendered under FashionCurationResults from render.narration.next_steps. */
export function NextStepChips({
  nextSteps,
  assumptionLines,
  onSend,
}: {
  nextSteps: { text: string; chips: string[] };
  assumptionLines?: string[];
  onSend: (t: string) => void;
}) {
  return (
    <div className="mt-3 space-y-2">
      {assumptionLines && assumptionLines.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {assumptionLines.map((a, i) => (
            <li key={i}>· {a}</li>
          ))}
        </ul>
      )}
      <div className="text-sm">{nextSteps.text}</div>
      <div className="flex flex-wrap gap-2">
        {nextSteps.chips.map((c) => (
          <button key={c} className="rounded-full border px-3 py-1 text-sm" onClick={() => onSend(c)}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
