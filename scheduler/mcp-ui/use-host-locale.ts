import { useEffect, useMemo, useState } from "react";


import { direction, normalizeLocale, type Locale } from "../lib/i18n/locales";
import { createTranslator, type Messages } from "../lib/i18n/translate";

import { bindWidgetLocale } from "./widget-locale";

import type { App } from "@modelcontextprotocol/ext-apps";

declare const __SIMPLEPOST_WIDGET_LOCALE_ASSETS__: Record<Exclude<Locale, "en">, string>;

async function loadWidgetMessages(locale: Locale): Promise<Messages> {
  if (locale === "en") return {};
  const url = new URL(__SIMPLEPOST_WIDGET_LOCALE_ASSETS__[locale], import.meta.url);
  const module = (await import(url.href)) as { default: Messages };
  return module.default;
}

function compatibilityLocale() {
  return (window as Window & { openai?: { locale?: unknown } }).openai?.locale;
}

/** Hosts can send the locale during initialization or update it after mounting. */
export function useHostLocale(app: App | null | undefined) {
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(compatibilityLocale()) ?? "en");
  const [active, setActive] = useState<{ locale: Locale; messages: Messages }>({ locale: "en", messages: {} });

  useEffect(() => {
    const sync = () =>
      setLocale(normalizeLocale(app?.getHostContext()?.locale) ?? normalizeLocale(compatibilityLocale()) ?? "en");
    sync();
    app?.addEventListener("hostcontextchanged", sync);
    window.addEventListener("openai:set_globals", sync);
    return () => {
      app?.removeEventListener("hostcontextchanged", sync);
      window.removeEventListener("openai:set_globals", sync);
    };
  }, [app]);

  useEffect(() => {
    let current = true;
    void loadWidgetMessages(locale).then(
      (messages) => {
        if (current) setActive({ locale, messages });
      },
      () => {
        // Keep the widget usable even if an optional language file cannot load.
        if (current) setActive({ locale: "en", messages: {} });
      },
    );
    return () => {
      current = false;
    };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = active.locale;
    document.documentElement.dir = direction(active.locale);
  }, [active.locale]);

  useEffect(() => {
    if (app) bindWidgetLocale(app, active.locale, active.messages);
  }, [app, active]);

  return useMemo(() => ({ ...active, t: createTranslator(active.locale, active.messages) }), [active]);
}
