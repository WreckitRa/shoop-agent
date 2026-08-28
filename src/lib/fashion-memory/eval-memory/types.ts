import type {
  FashionFactType,
  RequestEventAttributes,
  StyleSignalSource,
  StyleSignalStatus,
  StyleSignalType,
} from "../types";

export type MemoryPersonRef = {
  relation: string;
  name?: string;
};

export type MemorySeedFact = {
  person: string;
  fact_type: FashionFactType | string;
  garment_type?: string;
  value: unknown;
};

export type MemorySeedSignal = {
  person: string;
  signal_type: StyleSignalType | string;
  value: string;
  polarity: 1 | -1;
  source: StyleSignalSource | string;
  context?: string;
  confidence?: number;
  status?: StyleSignalStatus | string;
};

export type MemorySeedRequestEvent = {
  person: string;
  conversation: string;
  attributes: Record<string, string>;
};

export type MemoryAskQuestion = {
  gap: string;
  text: string;
  garment_type?: string;
  field?: string;
  chips?: string[];
};

export type MemoryUserTurn = { user: string; conversation?: string };
export type MemoryAskTurn = {
  assistant_ask: { questions: MemoryAskQuestion[]; recipient?: string };
  conversation?: string;
};
export type MemoryResultsTurn = {
  assistant_results: {
    garments: string[];
    search_id: string;
    recipient: string;
    attributes?: Record<string, string>;
  };
  conversation?: string;
};
export type MemoryChipTurn = { chip_tap: string; conversation?: string };
export type MemoryRailTurn = {
  rail: {
    kind: string;
    search_id: string;
    ref: string;
    attrs: Record<string, string>;
  };
  conversation?: string;
};
export type MemoryPurchaseTurn = {
  purchase: {
    search_id: string;
    ref: string;
    attrs: Record<string, string>;
  };
  conversation?: string;
};
export type MemorySweepTurn = { sweep: true; conversation?: string };

export type MemoryTurn =
  | MemoryUserTurn
  | MemoryAskTurn
  | MemoryResultsTurn
  | MemoryChipTurn
  | MemoryRailTurn
  | MemoryPurchaseTurn
  | MemorySweepTurn;

export type MemoryExpectFact = {
  person: string;
  fact_type: string;
  garment_type?: string;
  value: unknown;
  status: "active" | "superseded";
};

export type MemoryExpectSignal = {
  person: string;
  signal_type: string;
  value: string;
  polarity: 1 | -1;
  source: string;
  status: string;
  context?: string;
  confidence?: number;
};

export type MemoryForbidden = {
  person: string;
  fact_type?: string;
  signal_type?: string;
  value?: string;
};

export type MemoryCase = {
  id: string;
  seed: {
    people: MemoryPersonRef[];
    facts?: MemorySeedFact[];
    signals?: MemorySeedSignal[];
    request_events?: MemorySeedRequestEvent[];
  };
  turns: MemoryTurn[];
  expect: {
    people: MemoryPersonRef[];
    facts: MemoryExpectFact[];
    signals: MemoryExpectSignal[];
    forbidden: MemoryForbidden[];
    ambiguous_subjects?: number;
    next_router_asks?: { gap: string; chips_include: string[] }[];
    request_events?: { person: string; count: number }[];
    /** buy-02: purchase must lead formatRecentPicksLine over clicks. */
    recent_picks_prefers_purchase?: boolean;
  };
};

export type StoreKind = "supabase" | "local";

export type CaseDiff = {
  missing: string[];
  extra: string[];
  forbidden: string[];
  wrong_person: string[];
  status_mismatch: string[];
  ambiguous_subjects?: { expected: number; actual: number };
  next_router_asks?: string[];
  request_events?: string[];
  recent_picks?: string[];
};

export type ClerkOpTrace = {
  op: string;
  accepted: boolean;
  reason?: string;
  emitted: Record<string, unknown>;
};

export type ClerkTurnTrace = {
  skipped?: string;
  traces: ClerkOpTrace[];
};

export type CaseResult = {
  id: string;
  store: StoreKind;
  pass: boolean;
  skipped?: string;
  error?: string;
  diff: CaseDiff;
  clerk: ClerkTurnTrace[];
  counts: {
    missing: number;
    extra: number;
    forbidden: number;
    wrong_person: number;
    expected_items: number;
  };
  /** Stable fingerprint of dump for flake identical-state. */
  stateKey?: string;
  attempts?: number;
  flake?: boolean;
  flake_unstable?: boolean;
};

export type MemoryEvalAggregate = {
  cases: number;
  passed: number;
  failed: number;
  skipped: number;
  retried: number;
  flakes: number;
  flake_rate: number;
  flake_unstable: number;
  wrong_person_rate: number;
  forbidden_rate: number;
  missed_rate: number;
  extra_rate: number;
};

export type DumpedPerson = {
  id: string;
  relation: string;
  name: string | null;
};

export type DumpedFact = {
  person_id: string;
  person: string;
  fact_type: string;
  garment_type: string | null;
  value: unknown;
  status: string;
};

export type DumpedSignal = {
  person_id: string;
  person: string;
  signal_type: string;
  value: string;
  polarity: 1 | -1;
  source: string;
  status: string;
  context: string;
  confidence: number;
};

export type DumpedRequestEvent = {
  person_id: string;
  person: string;
  conversation_id: string | null;
  attributes: RequestEventAttributes;
};

export type StoreDump = {
  people: DumpedPerson[];
  facts: DumpedFact[];
  signals: DumpedSignal[];
  request_events: DumpedRequestEvent[];
  ambiguous_subjects: number;
  next_router_asks: { gap: string; chips: string[] }[];
  recent_picks_line: string | null;
  watermark: string | null;
};
