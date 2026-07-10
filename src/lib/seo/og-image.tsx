import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { colors } from "@/lib/design/tokens";
import {
  SITE_NAME,
  SITE_TAGLINE,
  getSiteUrl,
} from "@/lib/seo/site";

export const ogImageAlt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const ogImageSize = { width: 1200, height: 630 };
export const ogImageContentType = "image/png";

const FEATURES = [
  "Search every store",
  "Honest buy · wait · skip picks",
  "Personalized to you",
] as const;

async function loadLogoDataUri(): Promise<string | null> {
  try {
    const svg = await readFile(
      join(process.cwd(), "public/assets/shoop-logo.svg"),
      "utf8",
    );
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } catch {
    return null;
  }
}

type OgCardOptions = {
  title?: string;
  subtitle?: string;
  domain?: string;
};

/** Shared 1200×630 social preview card (Open Graph + Twitter). */
export async function renderOgImage(options: OgCardOptions = {}) {
  const logoSrc = await loadLogoDataUri();
  const domain = options.domain ?? getSiteUrl().host;
  const title = options.title ?? SITE_NAME;
  const subtitle = options.subtitle ?? SITE_TAGLINE;

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(145deg, ${colors.surface.page} 0%, ${colors.brand.tint} 48%, #FFFFFF 100%)`,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            padding: "56px 72px 40px",
          }}
        >
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori OG renderer
            <img
              src={logoSrc}
              alt=""
              width={340}
              height={92}
              style={{ marginBottom: 28 }}
            />
          ) : (
            <div
              style={{
                fontSize: 88,
                fontWeight: 800,
                color: colors.brand.primary,
                letterSpacing: "-0.03em",
                marginBottom: 20,
              }}
            >
              {SITE_NAME}
            </div>
          )}

          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: colors.text.primary,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              maxWidth: 900,
            }}
          >
            {subtitle}
          </div>

          <div
            style={{
              marginTop: 22,
              fontSize: 26,
              lineHeight: 1.45,
              color: colors.text.soft,
              maxWidth: 880,
            }}
          >
            Your AI shopping concierge — real products, clear verdicts, no
            guesswork.
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 36,
            }}
          >
            {FEATURES.map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 22px",
                  borderRadius: 999,
                  background: colors.surface.page,
                  border: `1.5px solid ${colors.brand.borderLight}`,
                  color: colors.text.primary,
                  fontSize: 22,
                  fontWeight: 600,
                  boxShadow: "0 8px 24px rgba(227, 16, 15, 0.08)",
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "22px 72px 30px",
            borderTop: `1px solid ${colors.border.slate}`,
            background: "rgba(255,255,255,0.72)",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: colors.text.secondary,
            }}
          >
            {domain}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: colors.brand.primary,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: colors.brand.primary,
          }}
        />
      </div>
    ),
    {
      ...ogImageSize,
    },
  );
}
