import type { NextConfig } from "next";
import { UCP_AGENT_PROFILE_CACHE_CONTROL } from "./src/lib/env";

const nextConfig: NextConfig = {
  // Minimal self-contained server for Railway / container deploys.
  output: "standalone",
  images: {
    // Allow cache-bust query strings on local assets (e.g. hero ?v=…).
    localPatterns: [{ pathname: "/assets/**" }],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Security headers applied to every response.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js inline scripts + eval in dev; Stripe.js for Rye payments;
              // onnxruntime-web needs wasm eval for IMG.LY bg-removal
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://js.stripe.com",
              // Tailwind inline styles
              "style-src 'self' 'unsafe-inline'",
              // Shopify catalog images + Unsplash + common merchant CDNs
              "img-src 'self' data: blob: https: http:",
              // SSE + API calls; Stripe; IMG.LY model/wasm CDN for card cutouts
              "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://api.stripe.com https://m.stripe.com https://m.stripe.network https://staticimgly.com https://*.staticimgly.com blob: data:",
              "font-src 'self'",
              "worker-src 'self' blob:",
              // Embedded merchant storefront checkouts + Stripe Elements iframes
              "frame-src https:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          // Apex→www is edge 301; HSTS locks browsers onto HTTPS after first www hit.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        source: "/ucp-agent-profile.json",
        headers: [{ key: "Cache-Control", value: UCP_AGENT_PROFILE_CACHE_CONTROL }],
      },
      {
        // Disable reverse-proxy buffering for all API routes so SSE chunks
        // reach the client immediately. Standard text/json responses are
        // unaffected by this header.
        source: "/api/:path*",
        headers: [{ key: "X-Accel-Buffering", value: "no" }],
      },
    ];
  },
};

export default nextConfig;
