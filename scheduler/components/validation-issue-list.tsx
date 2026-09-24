import { useMemo } from "react";

import { PlatformIcon } from "@/components/platform-icons";
import { cn } from "@/lib/utils";
import { groupValidationIssues } from "@/lib/validation/issue-display";
import type { ConnectedAccount } from "@/types";

import type { ValidationIssue } from "@simple-post/sdk";

export function ValidationIssueList({
  issues,
  accounts,
  className,
}: {
  issues: ValidationIssue[];
  accounts?: ConnectedAccount[];
  className?: string;
}) {
  const groups = useMemo(() => groupValidationIssues(issues, accounts), [accounts, issues]);

  return (
    <div className={cn("space-y-2.5", className)}>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1">
          {group.platform ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <PlatformIcon platform={group.platform} className="h-3 w-3 shrink-0" />
              <span className="truncate">{group.accountName ?? group.platformName}</span>
              {group.accountName ? <span className="text-muted-foreground">· {group.platformName}</span> : null}
            </div>
          ) : null}
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground marker:text-muted-foreground/60">
            {group.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
