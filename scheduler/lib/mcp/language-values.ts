import { z } from "zod";

import { locales, type Locale } from "@/lib/i18n/locales";

export const responseLocaleSchema = z
  .enum(locales as [Locale, ...Locale[]])
  .optional()
  .describe("Language for this response only. Does not change saved preferences or user content.");
export const pluginLanguageSchema = z.enum(["auto", ...locales] as ["auto", ...Locale[]]);
