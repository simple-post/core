"use client";

import { useEffect, useRef } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useUiTranslation } from "./client";
import { languageNames, localeCookie, localeLabel, locales } from "./locales";

export function UiLanguageSelect({ className }: { className?: string }) {
  const { locale, t } = useUiTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const pendingRefresh = useRef<string | null>(null);
  const currentPath = query ? `${pathname}?${query}` : pathname;
  useEffect(() => {
    if (pendingRefresh.current === currentPath) {
      pendingRefresh.current = null;
      router.refresh();
    }
  }, [currentPath, router]);
  return (
    <label className={`locale-control${className ? ` ${className}` : ""}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </svg>
      <select
        dir="ltr"
        value={locale}
        aria-label={`${t("language")}: ${languageNames[locale]}`}
        title={languageNames[locale]}
        onChange={(event) => {
          const secure = location.protocol === "https:" ? "; Secure" : "";
          // eslint-disable-next-line unicorn/no-document-cookie -- Persist UI preference in browsers without Cookie Store API.
          document.cookie = `${localeCookie}=${encodeURIComponent(event.currentTarget.value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
          // The incoming cross-domain hint has already been saved in the cookie.
          // Remove it so it cannot override this new selection on refresh.
          const url = new URL(window.location.href);
          if (url.searchParams.has(localeCookie)) {
            url.searchParams.delete(localeCookie);
            pendingRefresh.current = `${url.pathname}${url.search}`;
            router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
          } else {
            router.refresh();
          }
        }}>
        {locales.map((value) => (
          <option key={value} value={value} lang={value} aria-label={languageNames[value]} title={languageNames[value]}>
            {localeLabel(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
