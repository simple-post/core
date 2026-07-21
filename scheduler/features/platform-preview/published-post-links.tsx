import { ExternalLink } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { getPlatformById } from "@/lib/config";
import { getPublishedPostLinkGroups } from "@/lib/posting/published-links";
import type { ConnectedAccount, SocialPost } from "@/types";

interface PublishedPostLinksProps {
  post: Pick<SocialPost, "accountResults" | "threadResults">;
  accounts: ConnectedAccount[];
}

export function PublishedPostLinks({ post, accounts }: PublishedPostLinksProps) {
  const groups = getPublishedPostLinkGroups(post, accounts);
  if (groups.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-label="Published links">
      <div className="section-kicker">
        <span className="section-kicker-dot" />
        <span className="section-kicker-label">Published links</span>
      </div>
      <div className="mt-2 space-y-3">
        {groups.map((group) => {
          const platform = getPlatformById(group.platform.toLowerCase());
          return (
            <div key={group.accountId} className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/40 p-3">
              <PlatformIconBadge platform={group.platform} className="size-8" iconClassName="text-sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{group.accountName}</p>
                <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {platform?.name || group.platform}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {group.links.map((link) => (
                  <Button key={`${link.label}-${link.url}`} asChild variant="outline" size="sm">
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      {link.label}
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
