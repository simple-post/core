import type React from "react";
import { Suspense } from "react";

import { Inter, JetBrains_Mono } from "next/font/google";

import { ClientErrorLogger } from "@/components/client-error-logger";
import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@/lib/query-client";

import type { Metadata } from "next";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
  metadataBase: new URL(appUrl),
  title: "SimplePost Scheduler",
  description: "Schedule and publish content across social platforms with the open-source SimplePost Scheduler.",
  openGraph: {
    title: "SimplePost Scheduler",
    description: "Schedule and publish content across social platforms with the open-source SimplePost Scheduler.",
    images: [{ url: "/simplepost-card.png", width: 1200, height: 630, alt: "SimplePost" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SimplePost Scheduler",
    description: "Schedule and publish content across social platforms with the open-source SimplePost Scheduler.",
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
          <ClientErrorLogger />
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
          <Toaster />
        </QueryClientProvider>
      </body>
    </html>
  );
}
