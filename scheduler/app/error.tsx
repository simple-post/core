"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden p-6">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div className="relative text-center space-y-4 animate-reveal">
        <div className="section-kicker justify-center">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Error</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground">
          Something <span className="text-primary">went wrong</span>
        </h2>
        <p className="text-sm text-muted-foreground">An unexpected error occurred.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
