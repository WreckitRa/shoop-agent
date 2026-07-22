import {
  asNormalizedOptions,
  mergeOptionPreviewsIntoFashionRouter,
} from "@/lib/fashion-memory/router/clarification-defaults";
import type {
  ClarificationOptionPreviewImage,
  MessageClarificationV1,
  MessageGiftDirectionsV1,
  MessageMetadata,
} from "./types";

function mergePreviewImagesIntoOptions<
  T extends { id: string; previewImages?: ClarificationOptionPreviewImage[] },
>(clientOptions: T[], serverOptions: T[]): T[] {
  const clientById = new Map(clientOptions.map((o) => [o.id, o]));
  return serverOptions.map((serverOpt) => {
    const clientOpt = clientById.get(serverOpt.id);
    const clientImages = clientOpt?.previewImages;
    const serverImages = serverOpt.previewImages;
    if (clientImages?.length && !serverImages?.length) {
      return { ...serverOpt, previewImages: clientImages };
    }
    if (clientImages && serverImages && clientImages.length > serverImages.length) {
      return { ...serverOpt, previewImages: clientImages };
    }
    return serverOpt;
  });
}

function mergeClarificationPreviews(
  client: MessageClarificationV1,
  server: MessageClarificationV1,
): MessageClarificationV1 {
  const questions = server.questions.map((sq, qi) => {
    const cq = client.questions[qi];
    if (!cq || cq.id !== sq.id) return sq;
    return {
      ...sq,
      options: mergePreviewImagesIntoOptions(cq.options, sq.options),
    };
  });
  return { ...server, questions };
}

function mergeGiftDirectionPreviews(
  client: MessageGiftDirectionsV1,
  server: MessageGiftDirectionsV1,
): MessageGiftDirectionsV1 {
  return {
    ...server,
    directions: mergePreviewImagesIntoOptions(client.directions, server.directions),
  };
}

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

  if (client.clarification && server.clarification) {
    out.clarification = mergeClarificationPreviews(
      client.clarification,
      server.clarification,
    );
  }

  if (client.giftDirections && server.giftDirections) {
    out.giftDirections = mergeGiftDirectionPreviews(
      client.giftDirections,
      server.giftDirections,
    );
  }

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
  if (!metadata) return false;
  if (metadata.clarification?.expectsOptionPreviews) return true;
  if (metadata.giftDirections?.expectsOptionPreviews) return true;
  if (metadata.fashionRouter?.expectsOptionPreviews) return true;
  return false;
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
  if (!metadata) return false;
  if (
    metadata.clarification?.questions.some((q) =>
      q.options.some((o) => (o.previewImages?.length ?? 0) > 0),
    )
  ) {
    return true;
  }
  if (
    metadata.giftDirections?.directions.some(
      (d) => (d.previewImages?.length ?? 0) > 0,
    )
  ) {
    return true;
  }
  if (metadata.fashionRouter && fashionHasPreviewImages(metadata.fashionRouter)) {
    return true;
  }
  return false;
}

/** Stop client poll / server rehydrate loops when previews cannot run. */
export function clearOptionPreviewExpectations(
  metadata: MessageMetadata,
): MessageMetadata | null {
  let changed = false;
  const out: MessageMetadata = { ...metadata };

  if (metadata.clarification?.expectsOptionPreviews) {
    out.clarification = {
      ...metadata.clarification,
      expectsOptionPreviews: false,
    };
    changed = true;
  }
  if (metadata.giftDirections?.expectsOptionPreviews) {
    out.giftDirections = {
      ...metadata.giftDirections,
      expectsOptionPreviews: false,
    };
    changed = true;
  }
  if (metadata.fashionRouter?.expectsOptionPreviews) {
    out.fashionRouter = {
      ...metadata.fashionRouter,
      expectsOptionPreviews: false,
    };
    changed = true;
  }

  return changed ? out : null;
}
