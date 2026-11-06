
import { normalizeLocale, type Locale } from "../lib/i18n/locales";
import { createTranslator, type MessageKey, type Messages } from "../lib/i18n/translate";

import type { SourceCopy } from "../lib/i18n/source-copy";
import type { App } from "@modelcontextprotocol/ext-apps";

const contexts = new WeakMap<App, { locale: Locale; copy: SourceCopy }>();

/** Translators belong to an individual host connection, never a shared mutable locale. */
export function bindWidgetLocale(app: App, locale: Locale, messages: Messages) {
  const t = createTranslator(locale, messages);
  contexts.set(app, { locale, copy: (source, values) => t(source as MessageKey, values) });
}

export function widgetLocale(app: App): Locale {
  return normalizeLocale(app.getHostContext()?.locale) ?? contexts.get(app)?.locale ?? "en";
}

export function widgetCopy(app: App): SourceCopy {
  const context = contexts.get(app);
  if (context && context.locale === widgetLocale(app)) return context.copy;
  const t = createTranslator(widgetLocale(app), {});
  return (source, values) => t(source as MessageKey, values);
}

/** Only locally authored fallback messages enter this adapter. Server detail remains verbatim. */
export function widgetFallback(message: string | null, copy: SourceCopy): string | null {
  switch (message) {
    case "The tool call failed.": {
      return copy("The tool call failed.");
    }
    case "The publishing workspace could not be opened.": {
      return copy("The publishing workspace could not be opened.");
    }
    case "The publishing workspace returned incomplete data. Please try again.": {
      return copy("The publishing workspace returned incomplete data. Please try again.");
    }
    default: {
      return message;
    }
  }
}
