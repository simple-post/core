"use client";

import { useRouter } from "next/navigation";
import { useUiTranslation } from "./client";
import { languageNames, localeCookie, locales } from "./locales";

export function UiLanguageSelect({ className }: { className?: string }) {
  const { locale, t } = useUiTranslation();
  const router = useRouter();
  return (
    <select
      className={className}
      value={locale}
      aria-label={t("language")}
      onChange={(event) => {
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${localeCookie}=${encodeURIComponent(event.currentTarget.value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
        router.refresh();
      }}>
      {locales.map((value) => (
        <option key={value} value={value} lang={value}>
          {languageNames[value]}
        </option>
      ))}
    </select>
  );
}
