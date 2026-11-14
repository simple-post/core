import { normalizeLocale, type Locale } from "../lib/i18n/locales";
import { createTranslator, type MessageKey, type Messages } from "../lib/i18n/translate";

import type { SourceCopy } from "../lib/i18n/source-copy";
import type { App } from "@modelcontextprotocol/ext-apps";

export function preferredWidgetLocale(
  hostLocale?: unknown,
  compatibilityLocale?: unknown,
  resourceLocale?: unknown,
): Locale {
  return normalizeLocale(hostLocale) ?? normalizeLocale(compatibilityLocale) ?? normalizeLocale(resourceLocale) ?? "en";
}

const preferences = new WeakMap<App, { language: string; responseLocale?: Locale; resolvedLocale?: Locale }>();
const listeners = new WeakMap<App, Set<() => void>>();
export function pluginLanguage(app: App) {
  return preferences.get(app)?.language ?? "auto";
}
export function responseLocale(app: App) {
  return preferences.get(app)?.responseLocale;
}
export function acceptWidgetLanguage(app: App, meta?: Record<string, unknown>) {
  if (!normalizeLocale(meta?.["simplepost/uiLocale"])) return;
  preferences.set(app, {
    language: typeof meta?.["simplepost/pluginLanguage"] === "string" ? meta["simplepost/pluginLanguage"] : "auto",
    responseLocale: normalizeLocale(meta?.["simplepost/responseLocale"]),
    resolvedLocale: normalizeLocale(meta?.["simplepost/uiLocale"]),
  });
  for (const listener of listeners.get(app) ?? []) listener();
}
export function subscribeWidgetLanguage(app: App, listener: () => void) {
  const set = listeners.get(app) ?? new Set();
  listeners.set(app, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
export function effectiveWidgetLocale(
  app: App | null | undefined,
  compatibility?: unknown,
  resource?: unknown,
): Locale {
  const preference = app && preferences.get(app);
  return preference && (preference.language !== "auto" || preference.responseLocale)
    ? (preference.resolvedLocale ?? "en")
    : preferredWidgetLocale(app?.getHostContext()?.locale, compatibility, resource);
}
const contexts = new WeakMap<App, { locale: Locale; copy: SourceCopy }>();

/** Translators belong to an individual host connection, never a shared mutable locale. */
export function bindWidgetLocale(app: App, locale: Locale, messages: Messages) {
  const t = createTranslator(locale, messages);
  contexts.set(app, { locale, copy: (source, values) => t(source as MessageKey, values) });
}

export function widgetLocale(app: App): Locale {
  return effectiveWidgetLocale(app, undefined, contexts.get(app)?.locale);
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
