import type React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { QueryClientProvider } from "@/lib/query-client";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SimplePost Scheduler - Schedule Posts Across All Platforms",
  description:
    "Schedule and publish content across X, Instagram, YouTube, TikTok, Facebook, and more. Part of the SimplePost ecosystem.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <QueryClientProvider>
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
        </QueryClientProvider>
      </body>
    </html>
  );
}
