"use client";

import { useEffect, useState } from "react";

import { useUiTranslation } from "./client";
import { validationCatalogLoaders } from "./validation-catalog-loaders";

import type { Locale } from "./locales";
import type { SourceCopy } from "./source-copy";

type Messages = Record<string, string>;

/** Local validation runs before a request. Load only this editor's active locale. */
export function useValidationCopy(active: boolean): SourceCopy | undefined {
  const { locale } = useUiTranslation();
  const [loaded, setLoaded] = useState<{ locale: Locale; messages: Messages }>();
  useEffect(() => {
    const load = active ? validationCatalogLoaders[locale] : undefined;
    if (!load) return;
    let stale = false;
    void load()
      .then((messages) => {
        if (!stale) setLoaded({ locale, messages });
      })
      .catch(() => {
        // The validation result remains usable if its optional locale chunk fails.
      });
    return () => {
      stale = true;
    };
  }, [active, locale]);
  if (loaded?.locale !== locale) return;
  const number = new Intl.NumberFormat(locale);
  return (source, values = {}) =>
    (loaded.messages[source] ?? source).replaceAll(
      /{{(\w+)(,\s*number)?}}/g,
      (token: string, key: string, format: string | undefined) => {
        const value = values[key];
        if (value === undefined) return token;
        return format && typeof value === "number" ? number.format(value) : String(value);
      },
    );
}
