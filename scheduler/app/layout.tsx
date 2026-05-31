import type React from "react";
import { Suspense } from "react";

import { Inter, JetBrains_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@/lib/query-client";

import type { Metadata } from "next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SimplePost - Schedule Posts Across All Platforms",
  description:
    "Schedule and publish content across X, Instagram, YouTube, TikTok, Facebook, and more. Part of the SimplePost ecosystem.",
  openGraph: {
    title: "SimplePost - Schedule Posts Across All Platforms",
    description:
      "Schedule and publish content across X, Instagram, YouTube, TikTok, Facebook, and more. Part of the SimplePost ecosystem.",
    images: [{ url: "/simplepost-card.png", width: 1200, height: 630, alt: "SimplePost" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SimplePost - Schedule Posts Across All Platforms",
    description:
      "Schedule and publish content across X, Instagram, YouTube, TikTok, Facebook, and more. Part of the SimplePost ecosystem.",
    images: ["/simplepost-card.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <QueryClientProvider>
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
          <Toaster />
        </QueryClientProvider>
      </body>
    </html>
  );
}
