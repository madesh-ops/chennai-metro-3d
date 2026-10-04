import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const tamil = localFont({
  src: "../fonts/NotoSansTamil-Tamil.woff2",
  variable: "--font-tamil",
  weight: "400 600",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Chennai Metro 3D — Explore the journey",
    template: "%s · Chennai Metro 3D",
  },
  description:
    "Ride Chennai Metro Line 4 from Poonamallee Bypass to Vadapalani in an interactive real-time 3D simulation. Built on open data, no paid APIs.",
  applicationName: "Chennai Metro 3D",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#070B12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${tamil.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
