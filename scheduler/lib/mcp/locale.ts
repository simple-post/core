import { AsyncLocalStorage } from "node:async_hooks";

import { localeFromRequestHeaders, normalizeLocale, type Locale } from "@/lib/i18n/locales";
import { loadMessages } from "@/lib/i18n/resources";
import { withServerLocale } from "@/lib/i18n/server";
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

export function mcpUiLocale(ctx?: Pick<ServerContext, "mcpReq" | "http">, fallback?: Locale): Locale {
  return (
    normalizeLocale(ctx?.mcpReq?._meta?.["openai/locale"]) ??
    normalizeLocale(ctx?.mcpReq?._meta?.["webplus/i18n"]) ??
    normalizeLocale(ctx?.mcpReq?._meta?.locale) ??
    fallback ??
    localeFromRequestHeaders(ctx?.http?.req?.headers)
  );
}

export function withMcpUiTranslation<T>(ctx: ServerContext, fn: () => Promise<T>, fallback?: Locale): Promise<T> {
  return withMcpLocale(mcpUiLocale(ctx, fallback), fn);
}

/** Read only optional display metadata. The original body and protocol validation remain with the SDK. */
export async function mcpRequestLocale(req: Request, savedPreference?: unknown): Promise<Locale> {
  const fallback = localeFromRequestHeaders(req.headers, savedPreference);
  if (req.method !== "POST") return fallback;
  try {
    const body: unknown = await req.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body) || !("params" in body)) return fallback;
    const params = body.params;
    if (!params || typeof params !== "object" || !("_meta" in params)) return fallback;
    const meta = params._meta;
    if (!meta || typeof meta !== "object") return fallback;
    return (
      normalizeLocale((meta as Record<string, unknown>)["openai/locale"]) ??
      normalizeLocale((meta as Record<string, unknown>)["webplus/i18n"]) ??
      normalizeLocale((meta as Record<string, unknown>).locale) ??
      fallback
    );
  } catch {
    return fallback;
  }
}

export async function withMcpLocale<T>(locale: Locale, fn: () => T | Promise<T>): Promise<T> {
  const messages = await loadMessages(locale);
  return withServerLocale(locale, () => translations.run({ locale, t: createTranslator(locale, messages) }, fn));
}
