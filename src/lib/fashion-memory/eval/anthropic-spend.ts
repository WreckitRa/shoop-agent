/**
 * Org monthly spend limit + headroom for eval runs.
 *
 * Console Billing "Spend limits" is not on the Messages API key. Prefer
 * ANTHROPIC_ADMIN_API_KEY (cost_report) + EVAL_ORG_MONTHLY_SPEND_LIMIT_USD
 * (operator-entered after raising the limit in Console).
 *
 * Block until raised: require remaining headroom, or explicit
 * EVAL_ORG_SPEND_ALLOW_RUN=1 after the human raises the Console limit.
 */

export type OrgSpendHeadroom = {
  monthlyLimitUsd: number | null;
  mtdSpendUsd: number | null;
  remainingUsd: number | null;
  source: string;
  /** True when limit > baseline (default: previously-hit floor). */
  raised: boolean | null;
};

function envUsd(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function adminKey(): string | null {
  const k =
    process.env.ANTHROPIC_ADMIN_API_KEY?.trim() ||
    process.env.ANTHROPIC_ADMIN_KEY?.trim() ||
    null;
  return k || null;
}

/** Minor units (cents) → USD. Cost API returns decimal strings in cents. */
function centsToUsd(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

async function fetchMtdSpendUsd(key: string): Promise<number | null> {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const url =
    `https://api.anthropic.com/v1/organizations/cost_report` +
    `?starting_at=${encodeURIComponent(start.toISOString())}` +
    `&ending_at=${encodeURIComponent(end.toISOString())}` +
    `&limit=31`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `cost_report ${res.status}: ${body.slice(0, 200) || res.statusText}`,
    );
  }
  const json = (await res.json()) as {
    data?: Array<{ results?: Array<{ amount?: string }> }>;
  };
  let cents = 0;
  for (const bucket of json.data ?? []) {
    for (const row of bucket.results ?? []) {
      cents += Number(row.amount ?? 0) || 0;
    }
  }
  return centsToUsd(cents);
}

/**
 * Baseline the org hit before the raise request (Start tier cap is $500).
 * Override with EVAL_ORG_MONTHLY_SPEND_LIMIT_BASELINE_USD.
 */
export function spendLimitBaselineUsd(): number {
  return envUsd("EVAL_ORG_MONTHLY_SPEND_LIMIT_BASELINE_USD") ?? 500;
}

export async function fetchOrgSpendHeadroom(): Promise<OrgSpendHeadroom> {
  const limit =
    envUsd("EVAL_ORG_MONTHLY_SPEND_LIMIT_USD") ??
    envUsd("EVAL_ANTHROPIC_MONTHLY_LIMIT_USD");
  const baseline = spendLimitBaselineUsd();
  const key = adminKey();
  let mtd: number | null = envUsd("EVAL_ORG_MTD_SPEND_USD");
  const sources: string[] = [];

  if (limit != null) sources.push("EVAL_ORG_MONTHLY_SPEND_LIMIT_USD");
  if (mtd != null) sources.push("EVAL_ORG_MTD_SPEND_USD");

  if (key && mtd == null) {
    try {
      mtd = await fetchMtdSpendUsd(key);
      sources.push("cost_report");
    } catch (e) {
      sources.push(
        `cost_report_failed:${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (!key) {
    sources.push("no_ANTHROPIC_ADMIN_API_KEY");
  }

  const remaining =
    limit != null && mtd != null ? Math.max(0, limit - mtd) : null;
  const raised = limit != null ? limit > baseline : null;

  return {
    monthlyLimitUsd: limit,
    mtdSpendUsd: mtd,
    remainingUsd: remaining,
    source: sources.join("+") || "unset",
    raised,
  };
}

function fmtUsd(n: number | null): string {
  if (n == null) return "UNKNOWN";
  return `$${n.toFixed(2)}`;
}

/** Always print; never throws. */
export function printOrgSpendHeadroom(h: OrgSpendHeadroom): void {
  const baseline = spendLimitBaselineUsd();
  console.log(
    `[eval] org monthly spend limit: ${fmtUsd(h.monthlyLimitUsd)} (baseline was ${fmtUsd(baseline)}; raised=${h.raised ?? "UNKNOWN"})`,
  );
  console.log(`[eval] MTD spend: ${fmtUsd(h.mtdSpendUsd)}`);
  console.log(`[eval] remaining headroom: ${fmtUsd(h.remainingUsd)}`);
  console.log(`[eval] spend source: ${h.source}`);
}

/**
 * Refuse eval work until the org monthly spend limit is confirmed raised
 * (or the operator explicitly unlocks with EVAL_ORG_SPEND_ALLOW_RUN=1).
 */
export function assertOrgSpendLimitRaised(h: OrgSpendHeadroom): void {
  if (process.env.EVAL_ORG_SPEND_ALLOW_RUN === "1") {
    console.log(
      "[eval] EVAL_ORG_SPEND_ALLOW_RUN=1 — proceeding despite raise gate",
    );
    return;
  }
  if (h.raised === true) {
    if (h.remainingUsd != null && h.remainingUsd < 5) {
      throw new Error(
        `[eval] STOP: remaining headroom ${fmtUsd(h.remainingUsd)} is too thin for a subset-30 run. Raise the Console spend limit or wait for reset.`,
      );
    }
    return;
  }
  throw new Error(
    [
      "[eval] STOP: org monthly spend limit not confirmed raised.",
      "Raise it in Claude Console → Settings → Billing (Spend limits),",
      `then set EVAL_ORG_MONTHLY_SPEND_LIMIT_USD to the new cap (must be > ${spendLimitBaselineUsd()}).`,
      "Optional: ANTHROPIC_ADMIN_API_KEY for live MTD via cost_report.",
      "Emergency unlock only: EVAL_ORG_SPEND_ALLOW_RUN=1",
    ].join(" "),
  );
}
