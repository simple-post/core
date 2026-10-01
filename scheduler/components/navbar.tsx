"use client";

import { useEffect, useState, type ReactNode } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Plus } from "lucide-react";

import { HelpLink } from "@/components/help-link";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

import { SimplePostBrand, WorkspaceNavigation } from "./visual/navigation";

interface NavbarProps {
  /** Page-specific contextual actions (e.g. Edit/Delete on a post). */
  actions?: ReactNode;
}

export function Navbar({ actions }: NavbarProps) {
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The primary nav is identical on every page; only the "Create post" CTA is
  // suppressed on the schedule page itself, where it would be redundant.
  const activeSection = pathname.startsWith("/accounts")
    ? "accounts"
    : pathname.startsWith("/social")
      ? "inbox"
      : pathname === "/" || pathname.startsWith("/posts") || pathname.startsWith("/schedule")
        ? "posts"
        : null;
  const showCreateCta = !pathname.startsWith("/schedule");

  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-background/80 backdrop-blur-[10px] transition-all duration-200",
        scrolled && "border-b border-border",
      )}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-6 sm:gap-3">
        <Link
          href="/"
          className="flex flex-shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
          aria-label="SimplePost home">
          <SimplePostBrand logoSrc="/simplepost-logo.png" />
        </Link>

        <WorkspaceNavigation
          includeInbox
          active={activeSection}
          renderItem={({ id, label, className, children }) => (
            <Link
              href={id === "posts" ? "/" : id === "inbox" ? "/social" : "/accounts"}
              aria-label={label}
              aria-current={activeSection === id ? "page" : undefined}
              className={className}>
              {children}
            </Link>
          )}
        />

        <div className="ml-auto flex flex-shrink-0 items-center gap-2 sm:gap-3">
          {actions}
          {showCreateCta && (
            <Button asChild size="sm" className="gap-2">
              <Link href="/schedule" aria-label="Create post">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Create post</span>
              </Link>
            </Button>
          )}
          <HelpLink className="shrink-0 py-2" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
