/** Turn a shop hostname into a readable label (no raw domains in the UI). */
export function friendlyStoreName(shopDomain: string | null | undefined): string {
  if (!shopDomain?.trim()) return "This store";
  const host = shopDomain.trim().replace(/^www\./i, "");
  const withoutShopify = host.replace(/\.myshopify\.com$/i, "");
  const base = withoutShopify.split(".")[0] ?? withoutShopify;
  const words = base
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!words) return "This store";
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}
