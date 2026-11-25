import type { ReactNode } from "react";

import { BarChart3, Inbox, LayoutGrid, Users } from "lucide-react";

import { useUiTranslation } from "@/lib/i18n/client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

export function SimplePostBrand({ logoSrc }: { logoSrc: string }) {
  return (
    <span className="simplepost-visual flex shrink-0 items-center gap-2">
      <img src={logoSrc} alt="" className="h-7 w-7 drop-shadow-lg" />
      <span className="hidden font-mono text-sm font-medium tracking-tight text-foreground sm:inline">SimplePost</span>
    </span>
  );
}
export type WorkspaceSection = "posts" | "analytics" | "accounts" | "inbox";

export function WorkspaceNavigation({
  active,
  renderItem,
  showAnalytics = false,
  includeInbox = false,
}: {
  active: WorkspaceSection | null;
  renderItem: (props: { id: WorkspaceSection; label: string; className: string; children: ReactNode }) => ReactNode;
  /** The analytics dashboard exists only in the web app, not inside assistant workspaces. */
  showAnalytics?: boolean;
  includeInbox?: boolean;
}) {
  const { t } = useUiTranslation();
  const { copy } = useUiCopy();
  return (
    <nav className="simplepost-visual ms-1 flex items-center gap-1 sm:ms-3" aria-label={t("workspaceSections")}>
      {[
        { id: "posts" as const, label: t("posts"), Icon: LayoutGrid },
        ...(showAnalytics ? [{ id: "analytics" as const, label: t("analytics"), Icon: BarChart3 }] : []),
        { id: "accounts" as const, label: t("accounts"), Icon: Users },
        ...(includeInbox ? [{ id: "inbox" as const, label: copy("Inbox"), Icon: Inbox }] : []),
      ].map(({ id, label, Icon }) => (
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
