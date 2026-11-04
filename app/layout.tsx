import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { appUrl } from "@/lib/config/env";

import "./globals.css";

// Self-hosted so installs, dev, CI, and builds never depend on Google Fonts.
const inter = localFont({
  src: "./fonts/InterVariable-latin.woff2",
  display: "swap",
  variable: "--font-inter",
  weight: "100 900",
  style: "normal",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "LeaveTrack",
    template: "%s · LeaveTrack",
  },
  description:
    "Submit leave, track balances, and approve your team's requests in one auditable place.",
  applicationName: "LeaveTrack",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "hsl(164 72% 24%)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a
          href="#main-content"
          className="focus:bg-primary focus:text-small focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:font-semibold"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
