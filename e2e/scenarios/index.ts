import { e2eJoeFirstMessage } from "./e2e-joe-first-message";
import { e2eCyprusColdProfile } from "./e2e-cyprus-cold-profile";
import { e2eCapsule300 } from "./e2e-capsule-300";
import { e2eAldoTranslated } from "./e2e-aldo-translated";
import { e2eTightBudgetHonest } from "./e2e-tight-budget-honest";
import { e2eWomensLeakBlocked } from "./e2e-womens-leak-blocked";
import { e2eInteractionChain } from "./e2e-interaction-chain";
import { e2eCurationFallbackRecurate } from "./e2e-curation-fallback-recurate";
import { e2eMemoryLoop } from "./e2e-memory-loop";
import { e2eFullSseTurn } from "./e2e-full-sse-turn";
import type { E2eScenario } from "../types";

export const ALL_SCENARIOS: E2eScenario[] = [
  e2eJoeFirstMessage,
  e2eCyprusColdProfile,
  e2eCapsule300,
  e2eAldoTranslated,
  e2eTightBudgetHonest,
  e2eWomensLeakBlocked,
  e2eInteractionChain,
  e2eCurationFallbackRecurate,
  e2eMemoryLoop,
  e2eFullSseTurn,
];

export function scenarioByName(name: string): E2eScenario | undefined {
  return ALL_SCENARIOS.find((s) => s.name === name);
}
