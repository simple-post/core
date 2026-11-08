import english from "./copy/en.json";

import type { Locale } from "./locales";

/** Register actual translated overlays only; no copied English target files. */
export const copyLoaders: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  en: async () => english,
  es: () => import("./copy/es.json").then(({ default: messages }) => messages),
  "pt-BR": () => import("./copy/pt-BR.json").then(({ default: messages }) => messages),
  fr: () => import("./copy/fr.json").then(({ default: messages }) => messages),
  de: () => import("./copy/de.json").then(({ default: messages }) => messages),
  ja: () => import("./copy/ja.json").then(({ default: messages }) => messages),
  it: () => import("./copy/it.json").then(({ default: messages }) => messages),
  ko: () => import("./copy/ko.json").then(({ default: messages }) => messages),
  "zh-Hans": () => import("./copy/zh-Hans.json").then(({ default: messages }) => messages),
  "zh-Hant": () => import("./copy/zh-Hant.json").then(({ default: messages }) => messages),
  ar: () => import("./copy/ar.json").then(({ default: messages }) => messages),
  hi: () => import("./copy/hi.json").then(({ default: messages }) => messages),
  id: () => import("./copy/id.json").then(({ default: messages }) => messages),
  tr: () => import("./copy/tr.json").then(({ default: messages }) => messages),
  bg: () => import("./copy/bg.json").then(({ default: messages }) => messages),
};

export async function loadCopyMessages(locale: Locale): Promise<Record<string, string>> {
  return copyLoaders[locale]?.() ?? {};
}
