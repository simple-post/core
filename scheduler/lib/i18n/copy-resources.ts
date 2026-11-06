import english from "./copy/en.json";

import type { Locale } from "./locales";

/** Register actual translated overlays only; no copied English target files. */
export const copyLoaders: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  en: async () => english,
};

export async function loadCopyMessages(locale: Locale): Promise<Record<string, string>> {
  return copyLoaders[locale]?.() ?? {};
}
