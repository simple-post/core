import l10 from "./social-messages/ar.json";
import l14 from "./social-messages/bg.json";
import l4 from "./social-messages/de.json";
import l0 from "./social-messages/en.json";
import l1 from "./social-messages/es.json";
import l3 from "./social-messages/fr.json";
import l11 from "./social-messages/hi.json";
import l12 from "./social-messages/id.json";
import l6 from "./social-messages/it.json";
import l5 from "./social-messages/ja.json";
import l7 from "./social-messages/ko.json";
import l2 from "./social-messages/pt-BR.json";
import l13 from "./social-messages/tr.json";
import l8 from "./social-messages/zh-Hans.json";
import l9 from "./social-messages/zh-Hant.json";

import type { Locale } from "./locales";
const catalogs = {
  en: l0,
  es: l1,
  "pt-BR": l2,
  fr: l3,
  de: l4,
  ja: l5,
  it: l6,
  ko: l7,
  "zh-Hans": l8,
  "zh-Hant": l9,
  ar: l10,
  hi: l11,
  id: l12,
  tr: l13,
  bg: l14,
};
export function socialMessages(locale: Locale) {
  return catalogs[locale];
}
