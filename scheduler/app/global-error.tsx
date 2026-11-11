"use client";

import { useEffect, useSyncExternalStore } from "react";

import { direction } from "@/lib/i18n/locales";
import { recoveryCopy, recoveryLocale } from "@/lib/i18n/recovery-copy";
import { logClientError } from "@/lib/logger/client";

const subscribe = () => () => {};
const serverLocale = () => "en" as const;
const browserLocale = () => recoveryLocale(document.cookie, navigator.languages);

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useSyncExternalStore(subscribe, browserLocale, serverLocale);
  const [title, detail, retry] = recoveryCopy[locale];
  useEffect(() => {
    logClientError(error, "Root layout failed", { area: "app.global-error-boundary", digest: error.digest });
  }, [error]);
  return (
    <html lang={locale} dir={direction(locale)}>
      <body>
        <main
          style={{
            minHeight: "70vh",
            display: "grid",
            placeContent: "center",
            textAlign: "center",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
          }}>
          <h1>{title}</h1>
          <p>{detail}</p>
          <button type="button" onClick={reset}>
            {retry}
          </button>
        </main>
      </body>
    </html>
  );
}
