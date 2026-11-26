"use client";

import { useState, type ReactNode } from "react";

import { Check } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { cn } from "@/lib/utils";
import { workspaceColors, workspaceColorStyle, type WorkspaceColor } from "@/lib/workspaces/colors";

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
            {color && <span className={cn("size-2.5 rounded-full", workspaceColorStyle[color]?.swatch)} aria-hidden />}
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

export function WorkspaceColorPicker({ color }: { color: WorkspaceColor }) {
  const [selected, setSelected] = useState(color);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Workspace color{" "}
        <span className="font-normal text-muted-foreground">· {workspaceColorStyle[selected]?.label}</span>
      </legend>
      <div className="flex flex-wrap gap-1">
        {workspaceColors.map((value) => (
          <label
            key={value}
            title={workspaceColorStyle[value].label}
            className="relative inline-flex size-10 cursor-pointer items-center justify-center">
            <input
              type="radio"
              value={value}
              name="color"
              checked={value === selected}
              onChange={() => setSelected(value)}
              className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden
              className={cn(
                "flex size-7 items-center justify-center rounded-full peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring",
                workspaceColorStyle[value].swatch,
              )}
            />
            <Check
              className="pointer-events-none absolute size-4 text-white opacity-0 peer-checked:opacity-100 dark:text-black"
              aria-hidden
            />
            <span className="sr-only">{workspaceColorStyle[value].label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
