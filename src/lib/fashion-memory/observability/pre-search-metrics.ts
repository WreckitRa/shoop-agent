/** Rolling pre-search funnel metrics for GET /api/health. */

const MAX_SAMPLES = 300;

type GatePath = "retry_llm" | "deterministic" | "clean";

type SearchSample = {
  clarificationTurns: number;
  zeroQuestion: boolean;
  occasionInferred: boolean;
  occasionCorrected: boolean;
  gatePath: GatePath;
  ts: number;
};

const searches: SearchSample[] = [];
let clarificationTurnsOpen = 0;

export function recordClarificationTurn(): void {
  clarificationTurnsOpen += 1;
}

export function recordReadyToSearchOutcome(params: {
  gatePath: GatePath;
  occasionInferred?: boolean;
  /** User later overrode an inferred occasion (tracked on follow-up). */
  occasionCorrected?: boolean;
  /** Clarification turns since last ready_to_search for this conversation (caller-supplied). */
  clarificationTurnsBeforeSearch?: number;
}): void {
  const clarificationTurns =
    params.clarificationTurnsBeforeSearch ?? clarificationTurnsOpen;
  searches.push({
    clarificationTurns,
    zeroQuestion: clarificationTurns === 0,
    occasionInferred: Boolean(params.occasionInferred),
    occasionCorrected: Boolean(params.occasionCorrected),
    gatePath: params.gatePath,
    ts: Date.now(),
  });
  clarificationTurnsOpen = 0;
  if (searches.length > MAX_SAMPLES) searches.shift();
}

/** Call when a clarification turn is emitted (not ready_to_search). */
export function noteClarificationEmitted(): void {
  recordClarificationTurn();
}

export function preSearchMetricsSnapshot(): {
  samples: number;
  clarification_turns_per_search: number;
  zero_question_search_rate: number;
  occasion_inferred_rate: number;
  occasion_correction_rate: number;
  gate_path: Record<GatePath, number>;
} {
  const n = searches.length;
  const sumClar = searches.reduce((a, s) => a + s.clarificationTurns, 0);
  const zero = searches.filter((s) => s.zeroQuestion).length;
  const inferred = searches.filter((s) => s.occasionInferred);
  const corrected = inferred.filter((s) => s.occasionCorrected).length;
  const gate_path: Record<GatePath, number> = {
    retry_llm: 0,
    deterministic: 0,
    clean: 0,
  };
  for (const s of searches) gate_path[s.gatePath] += 1;

  return {
    samples: n,
    clarification_turns_per_search: n ? sumClar / n : 0,
    zero_question_search_rate: n ? zero / n : 0,
    occasion_inferred_rate: n ? inferred.length / n : 0,
    occasion_correction_rate: inferred.length
      ? corrected / inferred.length
      : 0,
    gate_path,
  };
}

export function resetPreSearchMetricsForTests(): void {
  searches.length = 0;
  clarificationTurnsOpen = 0;
}
