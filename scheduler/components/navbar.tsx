"use client";

import { useEffect, useState, type ReactNode } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher, useWorkspaceIndex, workspaceHref } from "@/components/workspaces/switcher";
import { useBillingStatus, useWorkspaceReadOnly } from "@/hooks/use-billing";
import { useFeatures } from "@/hooks/use-features";
import { useUiTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import { SimplePostBrand, WorkspaceNavigation } from "./visual/navigation";

interface NavbarProps {
  /** Page-specific contextual actions (e.g. Edit/Delete on a post). */
  actions?: ReactNode;
}

export function Navbar({ actions }: NavbarProps) {
  const { locale, t } = useUiTranslation();
  const { hasFeature } = useFeatures();
  const readOnly = useWorkspaceReadOnly();
  const { data: billing } = useBillingStatus();
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The primary nav is identical on every page; only the "Create post" CTA is
  // suppressed on the schedule page itself, where it would be redundant.
  const { id, current } = useWorkspaceIndex();
  const showCreateCta = (id ? !!current && current.role !== "Viewer" : !readOnly) && !pathname.startsWith("/schedule");
  const activeSection = pathname.startsWith("/accounts")
    ? "accounts"
    : pathname.startsWith("/analytics")
      ? "analytics"
      : pathname.startsWith("/inbox")
        ? "inbox"
        : pathname === "/" || pathname.startsWith("/posts") || pathname.startsWith("/schedule")
          ? "posts"
          : null;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 bg-background/80 backdrop-blur-[10px] transition-all duration-200",
          scrolled && "border-b border-border",
        )}>
        <div className={cn("mx-auto flex h-14 max-w-6xl items-center gap-1 px-3 sm:gap-3 sm:px-6")}>
          <Link
            href={workspaceHref("/", id)}
            className="flex flex-shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
            aria-label={t("simplePostHome")}>
            <SimplePostBrand logoSrc="/simplepost-logo.png" showName={false} />
          </Link>

          <WorkspaceSwitcher />
          <WorkspaceNavigation
            showAnalytics={hasFeature("POST_ANALYTICS")}
            active={activeSection}
            includeAccounts={false}
            includeInbox={!readOnly && hasFeature("SOCIAL_INBOX")}
            renderItem={({ id: section, label, className, children }) => (
              <Link
                href={workspaceHref(section === "posts" ? "/" : `/${section}`, id)}
                aria-label={label}
                aria-current={section === activeSection ? "page" : undefined}
                className={className}>
                {children}
              </Link>
            )}
          />

          <div className="ms-auto flex flex-shrink-0 items-center gap-1.5 sm:gap-3">
            {!readOnly && actions}
            {showCreateCta && (
              <Button asChild size="sm" className="gap-2">
                <Link href={workspaceHref("/schedule", id)} aria-label={t("createPost")}>
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("createPost")}</span>
                </Link>
              </Button>
            )}
            <UserMenu accountsHref={workspaceHref("/accounts", id)} />
          </div>
        </div>
      </header>
      {!id && readOnly && billing?.trial && !pathname.startsWith("/billing") && pathname !== "/subscribe" && (
        <aside
          aria-label={t("trialExpired")}
          className="mx-auto mt-4 flex max-w-6xl flex-col gap-3 px-[clamp(18px,4vw,48px)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {t("trialMessage", {
              date: new Date(billing.trial.expiresAt).toLocaleDateString(locale, {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
            })}
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0 self-start">
            <Link href="/billing/plans">{t("choosePlan")}</Link>
          </Button>
        </aside>
      )}
    </>
  );
}
