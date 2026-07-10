/**
 * Gap detector + just-in-time probe.
 *
 * A great personal shopper doesn't hand you a 20-question intake form.
 * They ask the ONE thing they need to give a great answer, then never
 * ask it again.
 *
 * This module inspects:
 *   - the current user query (intent + category),
 *   - the user's typed profile state (UserProfile, SizingProfile, …),
 * and produces a tiny list of high-leverage questions for the agent to
 * weave into its reply naturally. The system prompt instructs the model
 * to surface at most 2 of these, in a conversational way.
 */

import { prisma } from "../db";
import {
  detectShoppingCategoryFromQuery,
  whatSizesAreNeeded,
} from "./category-detector";

export type GapProbe = {
  field: string;
  /** Short suggestion the model should ask in natural language. */
  prompt: string;
  /** Priority — higher items are surfaced first. */
  priority: number;
};

const GIFT_HINT =
  /\bgift\b|\bpresent\b|\bfor my\s+(?:wife|husband|brother|sister|mom|dad|mother|father|son|daughter|friend|boss|colleague|partner|girlfriend|boyfriend|spouse|parents?)\b/i;

const BUDGET_HINT =
  /\b(budget|under|less than|cheap|premium|luxury|expensive|affordable|price|$|usd|eur|aed)\b/i;

const PURCHASE_HINT =
  /\b(buy|purchase|order|recommend|suggest|find me|help me find|looking for|need a|want a|shopping for)\b/i;

function isShoppingTurn(query: string): boolean {
  if (PURCHASE_HINT.test(query)) return true;
  if (detectShoppingCategoryFromQuery(query).length > 0) return true;
  return false;
}

export async function detectShoppingGaps(params: {
  userId: string;
  query: string;
}): Promise<GapProbe[]> {
  const { userId, query } = params;
  const text = query.trim();
  if (!text) return [];
  if (!isShoppingTurn(text)) return [];

  const [profile, sizing, recipientCount] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        country: true,
        currency: true,
        shippingCountry: true,
        preferredName: true,
      },
    }),
    prisma.sizingProfile.findUnique({
      where: { userId },
      select: {
        shoeEU: true,
        shoeUS: true,
        topUsualSize: true,
        topPreferredFit: true,
        bottomWaist: true,
        bottomInseam: true,
        ringSize: true,
      },
    }),
    prisma.recipient.count({ where: { userId } }),
  ]);

  const probes: GapProbe[] = [];

  // 1. Shipping country / currency — needed for any purchase recommendation.
  if (!profile?.shippingCountry && !profile?.country) {
    probes.push({
      field: "shippingCountry",
      prompt: "where I'd be shipping to (country)",
      priority: 9,
    });
  }
  if (!profile?.currency) {
    probes.push({
      field: "currency",
      prompt: "what currency you usually shop in",
      priority: 5,
    });
  }

  // 2. Sizing — only if the query needs that body part.
  const sizesNeeded = whatSizesAreNeeded(text);

  if (sizesNeeded.includes("shoe") && sizing?.shoeEU == null && sizing?.shoeUS == null) {
    probes.push({
      field: "shoeSize",
      prompt: "your usual shoe size (EU 44? US 10?)",
      priority: 10,
    });
  }

  if (sizesNeeded.includes("top") && !sizing?.topUsualSize) {
    probes.push({
      field: "topSize",
      prompt: "your usual top size (S/M/L) and how you like the fit",
      priority: 8,
    });
  }

  if (sizesNeeded.includes("bottom") && !sizing?.bottomWaist && !sizing?.bottomInseam) {
    probes.push({
      field: "bottomSize",
      prompt: "your usual waist & inseam (e.g. 32×30) and fit preference",
      priority: 8,
    });
  }

  if (sizesNeeded.includes("ring") && !sizing?.ringSize) {
    probes.push({
      field: "ringSize",
      prompt: "the ring size",
      priority: 8,
    });
  }

  // 3. Gift recipient — if this looks like a gift turn and we have no recipients on file.
  if (GIFT_HINT.test(text) && recipientCount === 0) {
    probes.push({
      field: "recipientLabel",
      prompt: "a quick note about who this is for (relationship, age range, what they like)",
      priority: 9,
    });
  }

  // 4. Budget — only when the user is shopping but didn't mention a budget at all
  //    AND we have no per-category budget on file. Lower priority — many users
  //    will reveal budget naturally.
  if (!BUDGET_HINT.test(text)) {
    const categories = detectShoppingCategoryFromQuery(text);
    if (categories.length > 0) {
      const pref = await prisma.categoryPreference.findFirst({
        where: {
          userId,
          category: { in: categories },
          OR: [
            { budgetMin: { not: null } },
            { budgetMax: { not: null } },
            { budgetTypical: { not: null } },
          ],
        },
        select: { id: true },
      });
      if (!pref) {
        probes.push({
          field: "budget",
          prompt: "a rough budget range for this",
          priority: 4,
        });
      }
    }
  }

  probes.sort((a, b) => b.priority - a.priority);
  return probes.slice(0, 3);
}

/** Format the gap-probe block for injection into the system prompt. */
export function formatGapProbesXml(probes: GapProbe[]): string {
  if (probes.length === 0) return "";
  const lines = probes
    .slice(0, 3)
    .map((p, i) => `${i + 1}. (${p.field}) ${p.prompt}`)
    .join("\n");
  return [
    `<missing_profile_info>`,
    `The user hasn't told you these yet but they would meaningfully improve this recommendation.`,
    `Weave AT MOST 2 of these into your reply conversationally — never as a bulleted list, never as a form. Ask once and move on. If you can give a great answer without them, skip asking entirely.`,
    lines,
    `</missing_profile_info>`,
  ].join("\n");
}
