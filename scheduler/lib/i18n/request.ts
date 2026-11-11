import { cache } from "react";
import { cookies, headers } from "next/headers";
import { localeCookie, negotiateLocale } from "./locales";
import { loadMessages } from "./resources";
import { createTranslator } from "./translate";

export const getUiLocale = cache(async () => {
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  const preference = requestCookies.get(localeCookie)?.value;
  return negotiateLocale(preference, requestHeaders.get("accept-language") ?? undefined);
});

export const getUiTranslation = cache(async () => {
  const locale = await getUiLocale();
  const messages = await loadMessages(locale);
  return { locale, messages, t: createTranslator(locale, messages) };
});
