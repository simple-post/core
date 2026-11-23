import en from "./server-messages/en.json";
import es from "./server-messages/es.json";
import ptBR from "./server-messages/pt-BR.json";
import fr from "./server-messages/fr.json";
import de from "./server-messages/de.json";
import ja from "./server-messages/ja.json";
import it from "./server-messages/it.json";
import ko from "./server-messages/ko.json";
import zhHans from "./server-messages/zh-Hans.json";
import zhHant from "./server-messages/zh-Hant.json";
import ar from "./server-messages/ar.json";
import hi from "./server-messages/hi.json";
import id from "./server-messages/id.json";
import tr from "./server-messages/tr.json";
import bg from "./server-messages/bg.json";

import type { Locale } from "./locales";

export const serverCatalogs: Record<Locale, Record<string, string>> = {
  en,
  es,
  "pt-BR": ptBR,
  fr,
  de,
  ja,
  it,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ar,
  hi,
  id,
  tr,
  bg,
};
