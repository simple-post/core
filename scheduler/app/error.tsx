"use client";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { UiCopy } from "@/components/ui-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { logClientError } from "@/lib/logger/client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { copy } = useUiCopy();
  useEffect(() => {
    logClientError(error, "Unhandled React error boundary error", {
      area: "app.error-boundary",
      digest: error.digest,
      documentLanguage: document.documentElement.lang,
      translated:
        document.documentElement.classList.contains("translated-ltr") ||
        document.documentElement.classList.contains("translated-rtl"),
    });
  }, [error]);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden p-6">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div className="relative text-center space-y-4 animate-reveal">
        <div className="section-kicker justify-center">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">{copy("Error")}</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground">
          <UiCopy
            source="Something <part1>went wrong</part1>"
            components={{ part1: <span className="text-primary" /> }}
          />
        </h2>
        <p className="text-sm text-muted-foreground">{copy("An unexpected error occurred.")}</p>
        <Button onClick={reset}>{copy("Try again")}</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {copy("Reload page")}{" "}
        </Button>
      </div>
    </div>
  );
}
