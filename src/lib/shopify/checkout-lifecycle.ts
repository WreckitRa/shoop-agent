/**
 * Checkout MCP status lifecycle (Shopify mirrors UCP).
 * @see https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#lifecycle
 */
export const CHECKOUT_STATUSES = [
  "incomplete",
  "requires_escalation",
  "ready_for_complete",
  "complete_in_progress",
  "completed",
  "canceled",
] as const;

export type CheckoutLifecycleStatus = (typeof CHECKOUT_STATUSES)[number] | "unknown";

export type CheckoutMessage = {
  type?: string;
  code?: string;
  content?: string;
  severity?: string;
  path?: string;
};

export function parseCheckoutMessages(raw: unknown): CheckoutMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
    .map((m) => ({
      type: typeof m.type === "string" ? m.type : undefined,
      code: typeof m.code === "string" ? m.code : undefined,
      content: typeof m.content === "string" ? m.content : undefined,
      severity: typeof m.severity === "string" ? m.severity : undefined,
      path: typeof m.path === "string" ? m.path : undefined,
    }));
}

export function normalizeCheckoutStatus(raw: string | undefined | null): CheckoutLifecycleStatus {
  if (!raw) return "unknown";
  if ((CHECKOUT_STATUSES as readonly string[]).includes(raw)) {
    return raw as CheckoutLifecycleStatus;
  }
  return "unknown";
}

/** Buyer must pick another item — not a storefront handoff. */
const UNRECOVERABLE_CHECKOUT_CODES = new Set(["MERCHANDISE_NOT_AVAILABLE"]);

export function isUnrecoverableCheckoutMessage(message: CheckoutMessage): boolean {
  const code = message.code?.trim();
  if (code && UNRECOVERABLE_CHECKOUT_CODES.has(code)) return true;
  return false;
}

export function isUnrecoverableCheckoutFailure(
  status: CheckoutLifecycleStatus,
  messages: CheckoutMessage[],
): boolean {
  return messages.some(isUnrecoverableCheckoutMessage);
}

/**
 * Whether the web client should open Checkout Kit (popup / later inline) with
 * `continueUrl`. Escalation is a normal handoff — never treat it as an error
 * just because a message has `type: "error"`.
 */
export function shouldHandoffToCheckoutKit(
  status: CheckoutLifecycleStatus,
  messages: CheckoutMessage[],
  continueUrl: string | null | undefined,
): boolean {
  if (!continueUrl?.trim()) return false;
  if (isUnrecoverableCheckoutFailure(status, messages)) return false;

  switch (status) {
    case "requires_escalation":
    case "ready_for_complete":
      return true;
    case "incomplete": {
      if (messages.some((m) => m.severity === "recoverable")) return false;
      return true;
    }
    default:
      return false;
  }
}

export function unrecoverableCheckoutUserMessage(
  messages: CheckoutMessage[],
): string {
  const hit = messages.find(isUnrecoverableCheckoutMessage);
  return (
    hit?.content?.trim() ||
    "This item is no longer available. Please choose another product."
  );
}

function messageSeverities(messages: CheckoutMessage[]): Set<string> {
  return new Set(messages.map((m) => m.severity).filter((s): s is string => Boolean(s)));
}

export type CheckoutUiPlan = {
  status: CheckoutLifecycleStatus;
  badge: "neutral" | "info" | "warning" | "success" | "danger";
  title: string;
  detail: string;
  /** Prefer merchant storefront (UTM-attributed link). */
  primaryStorefront: boolean;
  /** Show “Refresh checkout state” (e.g. after complete_in_progress). */
  suggestRefresh: boolean;
  /** Email / update_checkout may resolve recoverable gaps. */
  suggestEmailUpdates: boolean;
  /** Optional in-app complete_checkout (needs real payment payload in production). */
  allowTryComplete: boolean;
  /** Session is done — prompt new cart/checkout if user continues shopping. */
  sessionEnded: boolean;
};

/**
 * Maps Shopify/UCP `checkout.status` + `messages[*]` to a structured UI plan
 * (badge, copy, suggested next actions). The orchestrating agent is still
 * responsible for higher-level decisions (re-prompting buyer, retrying, etc.).
 */
export function checkoutUiPlan(
  status: CheckoutLifecycleStatus,
  messages: CheckoutMessage[],
): CheckoutUiPlan {
  const sev = messageSeverities(messages);
  const hasRecoverable = sev.has("recoverable");
  const needsStorefront =
    sev.has("requires_buyer_input") ||
    sev.has("requires_buyer_review") ||
    status === "requires_escalation";

  switch (status) {
    case "completed":
      return {
        status,
        badge: "success",
        title: "Order placed",
        detail: "You're all set. We'll share updates here when they're available.",
        primaryStorefront: false,
        suggestRefresh: false,
        suggestEmailUpdates: false,
        allowTryComplete: false,
        sessionEnded: true,
      };
    case "canceled":
      return {
        status,
        badge: "danger",
        title: "Checkout expired",
        detail: "Start again if you'd still like to buy these items.",
        primaryStorefront: false,
        suggestRefresh: false,
        suggestEmailUpdates: false,
        allowTryComplete: false,
        sessionEnded: true,
      };
    case "complete_in_progress":
      return {
        status,
        badge: "info",
        title: "Processing your order…",
        detail: "Hang tight — we're confirming your payment.",
        primaryStorefront: false,
        suggestRefresh: true,
        suggestEmailUpdates: false,
        allowTryComplete: false,
        sessionEnded: false,
      };
    case "ready_for_complete":
      return {
        status,
        badge: "success",
        title: "Ready for payment",
        detail:
          "Your details look good. Continue to the store's secure checkout to review and pay.",
        primaryStorefront: true,
        suggestRefresh: true,
        suggestEmailUpdates: false,
        allowTryComplete: true,
        sessionEnded: false,
      };
    case "requires_escalation":
      return {
        status,
        badge: "warning",
        title: "Finish on the store's website",
        detail:
          "A few steps need to be completed on the store's site — we'll open it for you.",
        primaryStorefront: true,
        suggestRefresh: true,
        suggestEmailUpdates: hasRecoverable,
        allowTryComplete: false,
        sessionEnded: false,
      };
    case "incomplete":
      return {
        status,
        badge: needsStorefront || !hasRecoverable ? "warning" : "info",
        title: "Almost there",
        detail: needsStorefront
          ? "The store needs a bit more from you on their website."
          : hasRecoverable
            ? "Some details may be missing — check your address, email, or phone number."
            : "Add any missing details below, then try checkout again.",
        primaryStorefront: needsStorefront,
        suggestRefresh: true,
        suggestEmailUpdates: hasRecoverable || !needsStorefront,
        allowTryComplete: false,
        sessionEnded: false,
      };
    default:
      return {
        status: "unknown",
        badge: "neutral",
        title: "Checkout status unclear",
        detail:
          "Try again in a moment, or checkout on the store's website.",
        primaryStorefront: false,
        suggestRefresh: true,
        suggestEmailUpdates: true,
        allowTryComplete: false,
        sessionEnded: false,
      };
  }
}
