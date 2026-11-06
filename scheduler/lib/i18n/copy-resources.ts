import english from "./copy/en.json";

import type { Locale } from "./locales";

/** Register actual translated overlays only; no copied English target files. */
export const copyLoaders: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  en: async () => english,
  es: async () => (await import("./copy/es.json")).default,
  "pt-BR": async () => (await import("./copy/pt-BR.json")).default,
  fr: async () => (await import("./copy/fr.json")).default,
  de: async () => (await import("./copy/de.json")).default,
  ja: async () => (await import("./copy/ja.json")).default,
  it: async () => (await import("./copy/it.json")).default,
  ko: async () => (await import("./copy/ko.json")).default,
  "zh-Hans": async () => (await import("./copy/zh-Hans.json")).default,
  "zh-Hant": async () => (await import("./copy/zh-Hant.json")).default,
  ar: async () => (await import("./copy/ar.json")).default,
  hi: async () => (await import("./copy/hi.json")).default,
  id: async () => (await import("./copy/id.json")).default,
  tr: async () => (await import("./copy/tr.json")).default,
  bg: async () => (await import("./copy/bg.json")).default,
};

export async function loadCopyMessages(locale: Locale): Promise<Record<string, string>> {
  return copyLoaders[locale]?.() ?? {};
}
