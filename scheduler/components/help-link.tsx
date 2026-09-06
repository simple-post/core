import type { ReactNode } from "react";

import { CircleHelp } from "lucide-react";

import { docsUrl } from "@/lib/docs";
import { cn } from "@/lib/utils";

export function HelpLink({
  path = "/getting-started",
  children = "Help",
  className,
}: {
  path?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={docsUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}>
      <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  );
}
