import type { ReactNode } from "react";

import { Inbox, LayoutGrid, Users } from "lucide-react";

import { cn } from "@/lib/utils";

export function SimplePostBrand({ logoSrc }: { logoSrc: string }) {
  return (
    <span className="simplepost-visual flex shrink-0 items-center gap-2">
      <img src={logoSrc} alt="" className="h-7 w-7 drop-shadow-lg" />
      <span className="hidden font-mono text-sm font-medium tracking-tight text-foreground sm:inline">SimplePost</span>
    </span>
  );
}
export function WorkspaceNavigation({
  active,
  renderItem,
  includeInbox = false,
}: {
  active: "posts" | "accounts" | "inbox" | null;
  includeInbox?: boolean;
  renderItem: (props: {
    id: "posts" | "accounts" | "inbox";
    label: string;
    className: string;
    children: ReactNode;
  }) => ReactNode;
}) {
  return (
    <nav className="simplepost-visual ml-1 flex items-center gap-1 sm:ml-3" aria-label="Workspace sections">
      {(
        [
          { id: "posts", label: "Posts", Icon: LayoutGrid },
          { id: "accounts", label: "Accounts", Icon: Users },
          ...(includeInbox ? ([{ id: "inbox", label: "Inbox", Icon: Inbox }] as const) : []),
        ] as const
      ).map(({ id, label, Icon }) => (
        <span key={id}>
          {renderItem({
            id,
            label,
            className: cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3",
              active === id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            ),
            children: (
              <>
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </>
            ),
          })}
        </span>
      ))}
    </nav>
  );
}
