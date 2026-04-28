"use client";

import * as React from "react";

import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "border-b border-border inline-flex h-10 w-full items-center justify-start gap-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-10 items-center justify-center gap-1.5 px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:text-foreground",
        "data-[state=active]:after:absolute data-[state=active]:after:left-3 data-[state=active]:after:right-3 data-[state=active]:after:-bottom-px data-[state=active]:after:h-px data-[state=active]:after:bg-primary",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
