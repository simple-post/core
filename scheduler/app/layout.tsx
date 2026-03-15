import type React from "react";
import { Suspense } from "react";

import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@/lib/query-client";

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimplePost Scheduler - Schedule Posts Across All Platforms",
  description:
    "Schedule and publish content across X, Instagram, YouTube, TikTok, Facebook, and more. Part of the SimplePost ecosystem.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryClientProvider>
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
          <Toaster />
        </QueryClientProvider>
      </body>
    </html>
  );
}
