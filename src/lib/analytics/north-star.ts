import { prisma } from "@/lib/ai-chat/db";

/** Twin / 5 / 2 within 7 days of signup. */
export type NorthStarProgress = {
  userId: string;
  signupAt: Date | null;
  windowEndsAt: Date | null;
  twin: boolean;
  reactions: number;
  friendAsks: number;
  hit: boolean;
};

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read North Star progress from product_events for one user.
 * Twin = any twin_render_completed; reactions = distinct item_reacted item_ids;
 * friend asks = friend_ask_sent count. All within 7d of signup_completed.
 */
export async function getNorthStarProgress(
  userId: string,
): Promise<NorthStarProgress> {
  const signup = await prisma.productEvent.findFirst({
    where: { userId, name: "signup_completed" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!signup) {
    return {
      userId,
      signupAt: null,
      windowEndsAt: null,
      twin: false,
      reactions: 0,
      friendAsks: 0,
      hit: false,
    };
  }

  const windowEndsAt = new Date(signup.createdAt.getTime() + WINDOW_MS);
  const events = await prisma.productEvent.findMany({
    where: {
      userId,
      createdAt: { gte: signup.createdAt, lte: windowEndsAt },
      name: {
        in: ["twin_render_completed", "item_reacted", "friend_ask_sent"],
      },
    },
    select: { name: true, props: true },
  });

  const twin = events.some((e) => e.name === "twin_render_completed");
  const reactedIds = new Set<string>();
  let friendAsks = 0;
  for (const event of events) {
    if (event.name === "friend_ask_sent") {
      friendAsks += 1;
      continue;
    }
    if (event.name !== "item_reacted") continue;
    const props =
      event.props && typeof event.props === "object" && !Array.isArray(event.props)
        ? (event.props as Record<string, unknown>)
        : {};
    const itemId = typeof props.item_id === "string" ? props.item_id : null;
    if (itemId) reactedIds.add(itemId);
  }

  const reactions = reactedIds.size;
  return {
    userId,
    signupAt: signup.createdAt,
    windowEndsAt,
    twin,
    reactions,
    friendAsks,
    hit: twin && reactions >= 5 && friendAsks >= 2,
  };
}
