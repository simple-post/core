import { AsyncLocalStorage } from "node:async_hooks";

import { negotiateLocale, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { loadMessages } from "@/lib/i18n/resources";
import { createTranslator, type MessageKey, type MessageValues } from "@/lib/i18n/translate";

import type { ServerContext } from "@modelcontextprotocol/server";

const translations = new AsyncLocalStorage<{ locale: Locale; t: ReturnType<typeof createTranslator> }>();
const english = { locale: "en" as const, t: createTranslator("en", {}) };

export function mcpUiTranslation() {
  return translations.getStore() ?? english;
}

export function mcpText(key: MessageKey, values?: MessageValues) {
  return mcpUiTranslation().t(key, values);
}

export function mcpUiLocale(ctx?: Pick<ServerContext, "mcpReq" | "http">): Locale {
  return (
    normalizeLocale(ctx?.mcpReq?._meta?.["openai/locale"]) ??
    negotiateLocale(undefined, ctx?.http?.req?.headers.get("accept-language") ?? undefined)
  );
}

export function withMcpUiTranslation<T>(ctx: ServerContext, fn: () => Promise<T>): Promise<T> {
  return withMcpLocale(mcpUiLocale(ctx), fn);
}

export async function withMcpLocale<T>(locale: Locale, fn: () => T | Promise<T>): Promise<T> {
  const messages = await loadMessages(locale);
  return translations.run({ locale, t: createTranslator(locale, messages) }, fn);
}
