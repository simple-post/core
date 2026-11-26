"use client";
import type { ReactNode } from "react";

import { CalendarDays } from "lucide-react";

import { Navbar } from "@/components/navbar";
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

        <section className="animate-reveal animate-reveal-delay-1">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-primary">
              <CalendarDays className="h-3.5 w-3.5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{copy("Posts")}</h1>
          </div>
          {calendar}
        </section>

        <section className="mt-8 animate-reveal animate-reveal-delay-2">{children}</section>
      </main>
    </div>
  );
}
