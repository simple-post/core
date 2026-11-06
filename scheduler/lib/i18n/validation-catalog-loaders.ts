import type { Locale } from "./locales";

/** Register complete translated server catalogs alongside the server registry. */
export const validationCatalogLoaders: Partial<Record<Locale, () => Promise<Record<string, string>>>> = {};
