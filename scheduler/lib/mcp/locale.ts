import { AsyncLocalStorage } from "node:async_hooks";

import { negotiateLocale, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { loadMessages } from "@/lib/i18n/resources";
import { createTranslator } from "@/lib/i18n/translate";

import type { ServerContext } from "@modelcontextprotocol/server";

const translations = new AsyncLocalStorage<{ locale: Locale; t: ReturnType<typeof createTranslator> }>();
const english = { locale: "en" as const, t: createTranslator("en", {}) };

export function mcpUiTranslation() {
  return translations.getStore() ?? english;
}

export function mcpUiLocale(ctx?: Pick<ServerContext, "mcpReq" | "http">): Locale {
  return (
    normalizeLocale(ctx?.mcpReq?._meta?.["openai/locale"]) ??
    negotiateLocale(undefined, ctx?.http?.req?.headers.get("accept-language") ?? undefined)
  );
}

export async function withMcpUiTranslation<T>(ctx: ServerContext, fn: () => Promise<T>): Promise<T> {
  const locale = mcpUiLocale(ctx);
  const messages = await loadMessages(locale);
  return translations.run({ locale, t: createTranslator(locale, messages) }, fn);
}
