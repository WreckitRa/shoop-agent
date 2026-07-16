/** Fetch image bytes from a URL or data URL. */
export async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error("invalid image data url");
    return Uint8Array.from(Buffer.from(match[1], "base64"));
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
