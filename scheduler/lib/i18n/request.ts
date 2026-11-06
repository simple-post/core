import { cache } from "react";
import { cookies, headers } from "next/headers";
import { localeCookie, negotiateLocale } from "./locales";
import { loadMessages } from "./resources";
import { createTranslator } from "./translate";

export const getUiLocale = cache(async () => {
  const preference = (await cookies()).get(localeCookie)?.value;
  return negotiateLocale(preference, (await headers()).get("accept-language") ?? undefined);
});

export const getUiTranslation = cache(async () => {
  const locale = await getUiLocale();
  const messages = await loadMessages(locale);
  return { locale, messages, t: createTranslator(locale, messages) };
});
