import { localeCookie, negotiateLocale, type Locale } from "./locales";

/** Minimal standalone copy: root error boundaries cannot depend on the failed layout provider. */
export const recoveryCopy: Record<Locale, readonly [string, string, string]> = {
  en: ["Something went wrong", "Please try again.", "Try again"],
  es: ["Algo salió mal", "Vuelve a intentarlo.", "Reintentar"],
  "pt-BR": ["Algo deu errado", "Tente novamente.", "Tentar novamente"],
  fr: ["Une erreur est survenue", "Veuillez réessayer.", "Réessayer"],
  de: ["Etwas ist schiefgelaufen", "Bitte versuche es erneut.", "Erneut versuchen"],
  ja: ["問題が発生しました", "もう一度お試しください。", "再試行"],
  it: ["Si è verificato un errore", "Riprova.", "Riprova"],
  ko: ["문제가 발생했습니다", "다시 시도해 주세요.", "다시 시도"],
  "zh-Hans": ["出现了问题", "请重试。", "重试"],
  "zh-Hant": ["發生問題", "請再試一次。", "重試"],
  ar: ["حدث خطأ ما", "يرجى المحاولة مرة أخرى.", "إعادة المحاولة"],
  hi: ["कुछ गलत हो गया", "कृपया फिर से कोशिश करें।", "फिर से कोशिश करें"],
  id: ["Terjadi kesalahan", "Silakan coba lagi.", "Coba lagi"],
  tr: ["Bir hata oluştu", "Lütfen tekrar dene.", "Tekrar dene"],
  bg: ["Възникна проблем", "Моля, опитай отново.", "Опитай отново"],
};

export function recoveryLocale(cookie: string, browserLanguages: readonly string[]): Locale {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookie}=`))
    ?.slice(localeCookie.length + 1);
  let saved: string | undefined;
  try {
    saved = value ? decodeURIComponent(value) : undefined;
  } catch {
    /* Invalid cookie falls back to browser settings. */
  }
  return negotiateLocale(saved, browserLanguages.join(","));
}
