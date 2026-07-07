import type { Metadata } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Distinctive display grotesk for headings — paired with Geist for body.
const displayGrotesk = Schibsted_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? "https://poddaily.io"),
  title: {
    default: "poddaily — open-source Slack standup bot",
    template: "%s · poddaily",
  },
  description:
    "Self-hosted, open-source daily standup bot for Slack. Asks each teammate their standup questions over DM and posts one attributed summary to the team channel. Sign-in uses Slack's official OpenID Connect flow.",
  openGraph: {
    title: "poddaily — open-source Slack standup bot",
    description:
      "Self-hosted daily standups for Slack: DM-based questions, attributed channel summaries, timezone-aware scheduling. Source on GitHub.",
    url: "/",
    siteName: "poddaily",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayGrotesk.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
