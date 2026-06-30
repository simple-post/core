"use client";

import { useEffect } from "react";

import { logClientError } from "@/lib/logger/client";

export function ClientErrorLogger() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      logClientError(event.error || event.message, "Unhandled browser error", {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logClientError(event.reason, "Unhandled browser promise rejection");
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
