"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./locales";
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
