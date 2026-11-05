"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { languageNames, localeCookie, locales, type Locale } from "./locales";
import { createTranslator, type Messages } from "./translate";

const UiContext = createContext({ locale: "en" as Locale, t: createTranslator("en", {}) });

export function UiLocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, t: createTranslator(locale, messages) }), [locale, messages]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUiTranslation() {
  return useContext(UiContext);
}

export function UiLanguageSelect({ className }: { className?: string }) {
  const { locale, t } = useUiTranslation();
  return (
    <select
      className={className}
      value={locale}
      aria-label={t("language")}
      onChange={(event) => {
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${localeCookie}=${encodeURIComponent(event.currentTarget.value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
        location.reload();
      }}>
      {locales.map((value) => (
        <option key={value} value={value} lang={value}>
          {languageNames[value]}
        </option>
      ))}
    </select>
  );
}
