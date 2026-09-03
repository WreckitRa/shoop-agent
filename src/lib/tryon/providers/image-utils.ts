import { isTransientTryonStorageError } from "../storage";

const FETCH_RETRY_DELAYS_MS = [400, 1200];

async function fetchWithRetries(imageUrl: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) {
        const err = new Error(`image fetch ${res.status}`);
        if (
          attempt >= FETCH_RETRY_DELAYS_MS.length ||
          !isTransientTryonStorageError(err)
        ) {
          throw err;
        }
        last = err;
      } else {
        return res;
      }
    } catch (err) {
      last = err;
      if (
        attempt >= FETCH_RETRY_DELAYS_MS.length ||
        !isTransientTryonStorageError(err)
      ) {
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAYS_MS[attempt]));
  }
  throw last;
}

/** Fetch image bytes from a URL or data URL. */
export async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error("invalid image data url");
    return Uint8Array.from(Buffer.from(match[1], "base64"));
  }
  const res = await fetchWithRetries(imageUrl);
  return new Uint8Array(await res.arrayBuffer());
}
