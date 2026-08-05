import {
  asNormalizedOptions,
  mergeOptionPreviewsIntoFashionRouter,
} from "@/lib/fashion-memory/router/clarification-defaults";
import type { ClarificationOptionPreviewImage, MessageMetadata } from "./types";

function collectFashionClientPreviewImages(
  fashionRouter: NonNullable<MessageMetadata["fashionRouter"]>,
): Record<string, ClarificationOptionPreviewImage[]> {
  const clientImages: Record<string, ClarificationOptionPreviewImage[]> = {};
  const collect = (
    options?: NonNullable<
      NonNullable<MessageMetadata["fashionRouter"]>["questions"]
    >[number]["quick_options"],
  ) => {
    for (const o of asNormalizedOptions(options)) {
      if (o.previewImages?.length) clientImages[o.id] = o.previewImages;
    }
  };
  for (const q of fashionRouter.questions ?? []) {
    collect(q.quick_options);
  }
  collect(fashionRouter.ride_along?.quick_options);
  return clientImages;
}

/** Keep hydrated preview collages when terminal `done` metadata arrives early. */
export function mergeOptionPreviewMetadata(
  client: MessageMetadata | null | undefined,
  server: MessageMetadata | null | undefined,
): MessageMetadata | null | undefined {
  if (!server) return client ?? undefined;
  if (!client) return server;

  const out: MessageMetadata = { ...server };

  if (client.fashionRouter && server.fashionRouter) {
    const clientImages = collectFashionClientPreviewImages(client.fashionRouter);
    if (Object.keys(clientImages).length) {
      out.fashionRouter = mergeOptionPreviewsIntoFashionRouter(
        server.fashionRouter,
        clientImages,
      );
    }
  }

  return out;
}

export function messageExpectsOptionPreviews(
  metadata: MessageMetadata | null | undefined,
): boolean {
  return Boolean(metadata?.fashionRouter?.expectsOptionPreviews);
}

function fashionHasPreviewImages(
  metadata: NonNullable<MessageMetadata["fashionRouter"]>,
): boolean {
  const check = (
    options?: NonNullable<
      NonNullable<MessageMetadata["fashionRouter"]>["questions"]
    >[number]["quick_options"],
  ) => asNormalizedOptions(options).some((o) => (o.previewImages?.length ?? 0) > 0);
  if ((metadata.questions ?? []).some((q) => check(q.quick_options))) return true;
  return check(metadata.ride_along?.quick_options);
}

export function messageHasOptionPreviewImages(
  metadata: MessageMetadata | null | undefined,
): boolean {
  return Boolean(
    metadata?.fashionRouter && fashionHasPreviewImages(metadata.fashionRouter),
  );
}

/** Stop client poll / server rehydrate loops when previews cannot run. */
export function clearOptionPreviewExpectations(
  metadata: MessageMetadata,
): MessageMetadata | null {
  let changed = false;
  const out: MessageMetadata = { ...metadata };

  if (metadata.fashionRouter?.expectsOptionPreviews) {
    out.fashionRouter = {
      ...metadata.fashionRouter,
      expectsOptionPreviews: false,
    };
    changed = true;
  }

  return changed ? out : null;
}
