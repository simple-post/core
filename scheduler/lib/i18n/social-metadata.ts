import { socialMessages } from "./social-catalogs";

import type { Locale } from "./locales";
import type { Metadata } from "next";

export function schedulerMetadata(locale: Locale, appUrl: string): Metadata {
  const copy = socialMessages(locale);
  const maximized = new Intl.Locale(locale).maximize();
  return {
    metadataBase: new URL(appUrl),
    title: copy.coreMetaTitle,
    description: copy.coreMetaDescription,
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
    },
    openGraph: {
      title: copy.coreMetaTitle,
      description: copy.coreMetaDescription,
      images: [
        { url: `/social/${locale}/card.jpg`, width: 1200, height: 630, alt: `SimplePost — ${copy.coreOgHeadline}` },
      ],
      type: "website",
      locale: `${maximized.language}_${maximized.region}`,
    },
    // Next inherits the final page's Open Graph fields, including page overrides.
    twitter: { card: "summary_large_image" },
  };
}
