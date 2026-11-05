import { createInstance } from "i18next";
import type { Locale } from "./locales";
import english from "./messages/en.json";

export type MessageKey = keyof typeof english;
export type Messages = Partial<Record<MessageKey, string>> & Record<string, string>;
export type MessageValues = Record<string, string | number> & { count?: number };

export function createTranslator(locale: Locale, messages: Messages) {
  const instance = createInstance();
  // The resource bundle is already loaded. Never mutate a shared i18next
  // instance: concurrent requests and separate widgets can use different languages.
  void instance.init({
    lng: locale,
    fallbackLng: "en",
    initAsync: false,
    keySeparator: false,
    nsSeparator: false,
    resources:
      locale === "en"
        ? { en: { translation: english } }
        : { en: { translation: english }, [locale]: { translation: messages } },
    // React escapes rendered text. Other callers must not insert it as raw HTML.
    interpolation: { escapeValue: false },
  });
  return (key: MessageKey, values?: MessageValues) => instance.t(key, values);
}
