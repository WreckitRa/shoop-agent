import type { Metadata, Viewport } from "next";
import {
  Archivo,
  Cormorant_Garamond,
  DM_Sans,
  Fraunces,
  JetBrains_Mono,
  Nunito,
} from "next/font/google";
import { AuthGate } from "@/components/auth/AuthGate";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { SiteJsonLd } from "@/components/seo/SiteJsonLd";
import { rootMetadata } from "@/lib/seo/site";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-dm-sans",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-nunito",
});

export const metadata: Metadata = rootMetadata();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${cormorant.variable} ${archivo.variable} ${fraunces.variable} ${jetbrainsMono.variable} ${nunito.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://cdn.shopify.com" />
        <link rel="dns-prefetch" href="https://cdn.shopify.com" />
      </head>
      <body className="flex h-[100dvh] flex-col overflow-hidden bg-page font-sans text-ink">
        <SiteJsonLd />
        <AuthGate>{children}</AuthGate>
        <CookieBanner />
      </body>
    </html>
  );
}
