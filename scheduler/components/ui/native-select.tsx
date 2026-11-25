import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 min-w-0 max-w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:opacity-50",
        className,
      )}
    />
  );
}
