import type { Locale } from "./locales";
import type { Messages } from "./translate";

const loaders = {
  en: () => import("./messages/en.json").then((module) => module.default),
  es: () => import("./messages/es.json").then((module) => module.default),
  "pt-BR": () => import("./messages/pt-BR.json").then((module) => module.default),
  fr: () => import("./messages/fr.json").then((module) => module.default),
  de: () => import("./messages/de.json").then((module) => module.default),
  ja: () => import("./messages/ja.json").then((module) => module.default),
  it: () => import("./messages/it.json").then((module) => module.default),
  ko: () => import("./messages/ko.json").then((module) => module.default),
  "zh-Hans": () => import("./messages/zh-Hans.json").then((module) => module.default),
  "zh-Hant": () => import("./messages/zh-Hant.json").then((module) => module.default),
  ar: () => import("./messages/ar.json").then((module) => module.default),
  hi: () => import("./messages/hi.json").then((module) => module.default),
  id: () => import("./messages/id.json").then((module) => module.default),
  tr: () => import("./messages/tr.json").then((module) => module.default),
  bg: () => import("./messages/bg.json").then((module) => module.default),
} satisfies Record<Locale, () => Promise<Messages>>;

export function loadMessages(locale: Locale): Promise<Messages> {
  return loaders[locale]();
}
