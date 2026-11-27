"use client";

import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { workspaceColorHex, type WorkspaceColor } from "@/lib/workspaces/colors";

import { workspaceHref } from "./switcher";

export function WorkspaceSettingsLayout({
  id,
  name,
  color,
  sections,
  children,
}: {
  id?: string;
  name?: string;
  color?: WorkspaceColor;
  sections?: { id: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] pt-6 pb-16">
        <BackLink href={workspaceHref("/", id)} label="Back to posts" />
        <header className="mt-5 mb-6 border-b border-border pb-5">
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            {workspaceColorHex(color) && (
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: workspaceColorHex(color) }}
                aria-hidden
              />
            )}
            {name}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        </header>
        <div className="grid items-start gap-5 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
          <nav aria-label="Settings sections" className="flex flex-wrap gap-1 md:sticky md:top-20 md:flex-col">
            {sections?.map(({ id: sectionId, label }) => (
              <a
                key={sectionId}
                href={`#${sectionId}`}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
    </>
  );
}
