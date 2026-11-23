import { AsyncLocalStorage } from "node:async_hooks";

import { serverCatalogs } from "./server-catalogs";

import type { Locale } from "./locales";
import type { SourceCopy } from "./source-copy";

const requestLocale = new AsyncLocalStorage<Locale>();
export type AuthoredValues = Record<string, string | number | AuthoredMessage>;
export type AuthoredMessage = Readonly<{ source: string; values: AuthoredValues }>;
const descriptors = new WeakMap<object, AuthoredMessage>();

export function currentServerLocale(): Locale {
  return requestLocale.getStore() ?? "en";
}
export function withServerLocale<T>(locale: Locale, fn: () => T): T {
  return requestLocale.run(locale, fn);
}

/** The values can contain user content; only the explicitly authored template is translated. */
export function serverMessage(source: string, values: AuthoredValues = {}): AuthoredMessage {
  return { source, values };
}

export function createServerCopy(locale: Locale, catalog = serverCatalogs[locale]): SourceCopy {
  return (source, values = {}) => {
    const category = typeof values.count === "number" ? new Intl.PluralRules(locale).select(values.count) : undefined;
    const englishCategory =
      typeof values.count === "number" ? new Intl.PluralRules("en").select(values.count) : undefined;
    const template =
      (category && catalog?.[`${source}_${category}`]) ||
      catalog?.[source] ||
      (englishCategory && serverCatalogs.en?.[`${source}_${englishCategory}`]) ||
      serverCatalogs.en?.[source] ||
      source;
    return template.replaceAll(/{{(\w+)(,\s*number)?}}/g, (token: string, name: string, number: string | undefined) => {
      const value = values[name];
      if (value === undefined) return token;
      return number && typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : String(value);
    });
  };
}
export const serverT: SourceCopy = (source, values) => createServerCopy(currentServerLocale())(source, values);

/** Canonical English remains in logs and internal comparisons; presentation happens at response time. */
export function authoredError<T extends object>(error: T, message: AuthoredMessage): T {
  descriptors.set(error, message);
  return error;
}
export function renderServerMessage(message: AuthoredMessage, locale: Locale): string {
  const values = Object.fromEntries(
    Object.entries(message.values).map(([key, value]) => [
      key,
      typeof value === "object" ? renderServerMessage(value, locale) : value,
    ]),
  );
  return createServerCopy(locale)(message.source, values);
}
export function canonicalMessage(message: string | AuthoredMessage): string {
  return typeof message === "string" ? message : renderServerMessage(message, "en");
}
export function displayError(error: unknown, locale = currentServerLocale()): string {
  const descriptor = error && typeof error === "object" ? descriptors.get(error) : undefined;
  if (descriptor) return renderServerMessage(descriptor, locale);
  // Unmarked provider errors and arbitrary user content retain their original text.
  return error instanceof Error ? error.message : createServerCopy(locale)("An unexpected error occurred");
}
