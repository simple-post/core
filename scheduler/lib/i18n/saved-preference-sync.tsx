"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { useUiTranslation } from "./client";
import { cookieLocale, localeCookie, normalizeLocale } from "./locales";

/** Once signed in, keep background emails and MCP in the same chosen UI language. */
export function SavedUiPreferenceSync({ userId }: { userId: string }) {
  const { locale } = useUiTranslation();
  const router = useRouter();
  useEffect(() => {
    const abort = new AbortController();
    async function sync() {
      const cookie = cookieLocale({ get: () => document.cookie });
      if (!cookie) {
        const response = await fetch("/api/ui-preference", { signal: abort.signal });
        if (!response.ok) return;
        const data = await response.json();
        const saved = normalizeLocale(data.locale);
        if (abort.signal.aborted) return;
        if (saved) {
          const secure = location.protocol === "https:" ? "; Secure" : "";
          // eslint-disable-next-line unicorn/no-document-cookie -- Supports browsers without Cookie Store API.
          document.cookie = `${localeCookie}=${saved}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
          if (saved !== locale) router.refresh();
          return;
        }
      }
      await fetch("/api/ui-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: cookie ?? locale }),
        signal: abort.signal,
      });
    }
    void sync().catch(() => {
      /* The local preference remains usable when offline. */
    });
    return () => abort.abort();
  }, [userId, locale, router]);
  return null;
}
