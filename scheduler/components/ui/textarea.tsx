import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-border placeholder:text-muted-foreground bg-input flex field-sizing-content min-h-16 w-full rounded-lg border px-3 py-2 text-sm transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-primary/40 focus-visible:ring-primary/30 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
