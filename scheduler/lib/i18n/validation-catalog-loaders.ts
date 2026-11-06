import type { Locale } from "./locales";

/** Load the editor’s active validation language on demand. */
export const validationCatalogLoaders: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {
  es: () => import("./server-messages/es.json").then((module) => module.default),
  "pt-BR": () => import("./server-messages/pt-BR.json").then((module) => module.default),
  fr: () => import("./server-messages/fr.json").then((module) => module.default),
  de: () => import("./server-messages/de.json").then((module) => module.default),
  ja: () => import("./server-messages/ja.json").then((module) => module.default),
  it: () => import("./server-messages/it.json").then((module) => module.default),
  ko: () => import("./server-messages/ko.json").then((module) => module.default),
  "zh-Hans": () => import("./server-messages/zh-Hans.json").then((module) => module.default),
  "zh-Hant": () => import("./server-messages/zh-Hant.json").then((module) => module.default),
  ar: () => import("./server-messages/ar.json").then((module) => module.default),
  hi: () => import("./server-messages/hi.json").then((module) => module.default),
  id: () => import("./server-messages/id.json").then((module) => module.default),
  tr: () => import("./server-messages/tr.json").then((module) => module.default),
  bg: () => import("./server-messages/bg.json").then((module) => module.default),
};
