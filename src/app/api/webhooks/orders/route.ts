import { NextResponse } from "next/server";

import { logAiChat } from "@/lib/ai-chat/observability";
import { prisma } from "@/lib/ai-chat/db";
import { getShopifyClientSecret } from "@/lib/env";
import { summarizeShopifyAdminOrderWebhook } from "@/lib/shopify/admin-order-webhook";
import { verifyOrderWebhook } from "@/lib/shopify/orders";

/**
 * Shopify Admin order webhook receiver. Verifies the HMAC signature, then
 * defers processing via a microtask so the handler responds inside
 * Shopify's tight 5s budget regardless of downstream latency.
 *
 * On a paid/fulfilled order, all CartSession rows for the shop domain
 * are deleted — the user has completed checkout and the cart is stale.
 *
 * @see docs/shopify-ucp-tutorial/monitor-orders.md Step 6
 */
export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  let secret: string;
  try {
    secret = getShopifyClientSecret();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("SHOPIFY_CATALOG_CLIENT_SECRET")) {
      return new NextResponse("Webhook is not configured", { status: 503 });
    }
    throw error;
  }
  if (!verifyOrderWebhook(raw, request.headers, secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic");
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  queueMicrotask(async () => {
    try {
      const body = raw.toString("utf8");
      const parsed: unknown = body ? JSON.parse(body) : null;
      const summary = summarizeShopifyAdminOrderWebhook(parsed);

      logAiChat("info", "shopify_order_webhook_received", {
        topic,
        webhookId,
        shopDomain,
        orderId: summary.idString,
        orderName: summary.name,
        financialStatus: summary.financialStatus,
        fulfillmentStatus: summary.fulfillmentStatus,
        lineItemCount: summary.lineItems.length,
        currency: summary.currency,
      });

      // Clear completed cart sessions for this shop when an order is paid.
      // We can't correlate to a specific userId without order note attributes,
      // so we purge all sessions for the shop domain that have expired or that
      // look stale (last synced more than 5 minutes ago).
      const isPaidOrder =
        summary.financialStatus === "paid" ||
        summary.financialStatus === "partially_paid" ||
        summary.financialStatus === "authorized";

      if (shopDomain && isPaidOrder) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const deleted = await prisma.cartSession.deleteMany({
          where: {
            shopDomain,
            OR: [
              { expiresAt: { lte: new Date() } },
              { lastSyncedAt: { lte: fiveMinutesAgo } },
            ],
          },
        });
        if (deleted.count > 0) {
          logAiChat("info", "shopify_order_cart_sessions_cleared", {
            shopDomain,
            orderId: summary.idString,
            clearedCount: deleted.count,
          });
        }
      }
    } catch (error) {
      logAiChat("error", "shopify_order_webhook_processing_failed", {
        topic,
        webhookId,
        shopDomain,
        error,
      });
    }
  });

  return new NextResponse(null, { status: 200 });
}
