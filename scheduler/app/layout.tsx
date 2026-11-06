import type React from "react";
import { Suspense } from "react";

import { Inter, JetBrains_Mono } from "next/font/google";

import { AppAnalytics } from "@/components/app-analytics";
import { ClientErrorLogger } from "@/components/client-error-logger";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/lib/env";
import { UiLocaleProvider } from "@/lib/i18n/client";
import { direction } from "@/lib/i18n/locales";
import { getUiTranslation } from "@/lib/i18n/request";
import { schedulerMetadata } from "@/lib/i18n/social-metadata";
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

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getUiTranslation();
  return schedulerMetadata(locale, appUrl);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, messages, t } = await getUiTranslation();
  return (
    <html lang={locale} dir={direction(locale)} className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <UiLocaleProvider locale={locale} messages={messages}>
          <QueryClientProvider>
            <ClientErrorLogger />
            {!env.SELF_HOSTED && process.env.NODE_ENV === "production" && (
              <Suspense fallback={null}>
                <AppAnalytics />
              </Suspense>
            )}
            <Suspense fallback={<div>{t("loading")}</div>}>{children}</Suspense>
            <Toaster />
          </QueryClientProvider>
        </UiLocaleProvider>
      </body>
    </html>
  );
}
