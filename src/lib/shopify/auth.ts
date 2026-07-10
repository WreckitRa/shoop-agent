import { getShopifyClientId, getShopifyClientSecret } from "@/lib/env";

export type AccessTokenInfo = {
  access_token: string;
  scopes: string;
  exp: Date;
};

function decodeJwtPayload(accessToken: string): { scopes?: string; exp?: number } {
  try {
    const [, payload] = accessToken.split(".");
    if (!payload) return {};
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      scopes?: string;
      exp?: number;
    };
    return json;
  } catch {
    return {};
  }
}

let cachedToken: AccessTokenInfo | null = null;

export async function mintGlobalApiAccessToken(): Promise<AccessTokenInfo> {
  if (cachedToken && cachedToken.exp.getTime() > Date.now() + 60_000) {
    return cachedToken;
  }

  const clientId = getShopifyClientId();
  const clientSecret = getShopifyClientSecret();
  const res = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Token mint failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const { scopes, exp } = decodeJwtPayload(data.access_token);
  cachedToken = {
    access_token: data.access_token,
    scopes: scopes ?? "(see token)",
    exp: exp ? new Date(exp * 1000) : new Date(Date.now() + 3600_000),
  };
  return cachedToken;
}
