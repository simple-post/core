"use client";

import { useEffect } from "react";

import { logClientError } from "@/lib/logger/client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logClientError(error, "Root layout failed", { area: "app.global-error-boundary", digest: error.digest });
  }, [error]);
  return (
    <html lang="en">
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
          <h1>Something went wrong</h1>
          <p>Please try again.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
