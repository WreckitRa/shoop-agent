import type { MessageProductSearchV1 } from "./types";

function serverHasModelCuration(
  serverInv: MessageProductSearchV1["searches"][number],
): boolean {
  const serverPicks = serverInv.curatedPicks ?? [];
  return serverPicks.length > 0 && serverInv.curationFallback !== true;
}

/** Prefer live-stream curator patches over stale `done` metadata. */
export function mergeProductSearchMetadata(
  client: MessageProductSearchV1 | undefined,
  server: MessageProductSearchV1 | undefined,
): MessageProductSearchV1 | undefined {
  if (!server) return client;
  if (!client) return server;

  const clientByKey = new Map(
    client.searches.map((s) => [s.searchKey ?? s.query, s] as const),
  );

  const searches = server.searches.map((serverInv) => {
    const key = serverInv.searchKey ?? serverInv.query;
    const clientInv = clientByKey.get(key);
    if (!clientInv) return serverInv;

    const clientPicks = clientInv.curatedPicks ?? [];
    const serverPicks = serverInv.curatedPicks ?? [];
    const clientHasModelCuration =
      clientPicks.length > 0 &&
      clientInv.curationPending !== true &&
      clientInv.curationFallback !== true;
    const serverStillPending = serverInv.curationPending === true;
    const clientMoreComplete = clientPicks.length > serverPicks.length;
    const awaitingModelCuration =
      !serverHasModelCuration(serverInv) &&
      clientInv.curationPending === true;

    if (awaitingModelCuration) {
      return {
        ...serverInv,
        curatedPicks: clientPicks.length > 0 ? clientPicks : serverPicks,
        curationFallback: clientInv.curationFallback ?? serverInv.curationFallback,
        curationPending: clientInv.curationPending ?? true,
      };
    }

    const preferClient =
      clientHasModelCuration ||
      (clientPicks.length > 0 &&
        serverStillPending &&
        !clientInv.curationPending) ||
      clientMoreComplete;

    if (!preferClient) return serverInv;

    return {
      ...serverInv,
      curatedPicks: clientPicks,
      curationFallback: clientInv.curationFallback,
      curationPending: clientInv.curationPending,
    };
  });

  return { version: 1, searches };
}

/** When persisting the final assistant row, never clobber a finished curator patch. */
export function preserveEnhancedProductSearchOnPersist(
  incoming: MessageProductSearchV1 | undefined,
  existing: MessageProductSearchV1 | undefined,
): MessageProductSearchV1 | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const existingByKey = new Map(
    existing.searches.map((s) => [s.searchKey ?? s.query, s] as const),
  );

  const searches = incoming.searches.map((inv) => {
    const key = inv.searchKey ?? inv.query;
    const prev = existingByKey.get(key);
    if (
      prev &&
      prev.curationFallback === false &&
      (prev.curatedPicks?.length ?? 0) > 0
    ) {
      return prev;
    }
    return inv;
  });

  return { version: 1, searches };
}
