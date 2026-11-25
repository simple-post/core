"use client";
import type { ReactNode } from "react";

import { CalendarDays } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { UiCopy } from "@/components/ui-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
export function PostsDashboard({
  notices,
  calendar,
  children,
}: {
  notices?: ReactNode;
  calendar: ReactNode;
  children: ReactNode;
}) {
  const { copy } = useUiCopy();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        {notices}

        <div className="mb-6 flex items-center gap-3 animate-reveal">
          <div className="section-kicker !mb-0">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{copy("Dashboard")}</span>
          </div>
          <span className="h-3 w-px bg-border" />
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
            <UiCopy source="Your <part1>posts</part1>" components={{ part1: <span className="text-primary" /> }} />
          </h1>
        </div>

        <section className="animate-reveal animate-reveal-delay-1">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-primary">
              <CalendarDays className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{copy("Calendar")}</h2>
          </div>
          {calendar}
        </section>

        <section className="mt-8 animate-reveal animate-reveal-delay-2">{children}</section>
      </main>
    </div>
  );
}
