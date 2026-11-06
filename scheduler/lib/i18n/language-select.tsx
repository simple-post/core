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
        // eslint-disable-next-line unicorn/no-document-cookie -- Persist UI preference in browsers without Cookie Store API.
        document.cookie = `${localeCookie}=${encodeURIComponent(event.currentTarget.value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
        // The incoming cross-domain hint has already been saved in the cookie.
        // Remove it so it cannot override this new selection on refresh.
        const url = new URL(window.location.href);
        if (url.searchParams.has(localeCookie)) {
          url.searchParams.delete(localeCookie);
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        }
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
