import en from "./server-messages/en.json";

import type { Locale } from "./locales";

/** Actual, complete target catalogs are registered only after their coverage gate passes. */
export const serverCatalogs: Partial<Record<Locale, Record<string, string>>> = { en };
