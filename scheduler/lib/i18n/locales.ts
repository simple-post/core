export const languageNames = {
  en: "English",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  it: "Italiano",
  ko: "한국어",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ar: "العربية",
  hi: "हिन्दी",
  id: "Bahasa Indonesia",
  tr: "Türkçe",
  bg: "Български",
} as const;

export type Locale = keyof typeof languageNames;
export const locales = Object.keys(languageNames) as Locale[];
export const localeCookie = "ui_locale";

export function normalizeLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string" || value.length > 100) return;
  try {
    const canonical = new Intl.Locale(value.trim().replaceAll("_", "-"));
    const exact = locales.find((locale) => locale === canonical.baseName);
    if (exact) return exact;
    if (canonical.language === "zh") {
      return canonical.maximize().script === "Hant" ? "zh-Hant" : "zh-Hans";
    }
    if (canonical.language === "pt") return "pt-BR";
    return locales.find((locale) => locale === canonical.language);
  } catch {
    return undefined;
  }
}

export function negotiateLocale(preference?: string, acceptLanguage?: string): Locale {
  const preferred = normalizeLocale(preference);
  if (preferred) return preferred;
  const ranked = (acceptLanguage ?? "")
    .slice(0, 4096)
    .split(",")
    .map((entry, order) => {
      const [language, ...parameters] = entry.split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { locale: normalizeLocale(language), q: quality ? Number(quality.trim().slice(2)) : 1, order };
    })
    .filter(({ locale, q }) => locale && q > 0 && q <= 1);
  ranked.sort((a, b) => b.q - a.q || a.order - b.order);
  return ranked[0]?.locale ?? "en";
}

export function cookieLocale(headers?: Pick<Headers, "get"> | null): Locale | undefined {
  const preference = headers
    ?.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookie}=`))
    ?.slice(localeCookie.length + 1);
  try {
    return normalizeLocale(preference ? decodeURIComponent(preference) : undefined);
  } catch {
    return undefined;
  }
}

export function localeFromRequestHeaders(headers?: Pick<Headers, "get"> | null, savedPreference?: unknown) {
  return (
    cookieLocale(headers) ??
    normalizeLocale(savedPreference) ??
    negotiateLocale(undefined, headers?.get("accept-language") ?? undefined)
  );
}

export function direction(locale: Locale) {
  return locale === "ar" ? "rtl" : "ltr";
}
