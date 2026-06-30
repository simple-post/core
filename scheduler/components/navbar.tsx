"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LayoutGrid, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

/**
 * Primary navigation: the core workspace destinations shown on every app page.
 * To add a new top-level section, add an entry here. Account/settings pages
 * (Subscription, API keys, AI integrations) live in the UserMenu instead.
 */
interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: (pathname: string) => boolean;
}

const PRIMARY_NAV: NavItem[] = [
  {
    href: "/",
    label: "Posts",
    icon: LayoutGrid,
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/posts") || pathname.startsWith("/schedule"),
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: Users,
    isActive: (pathname) => pathname.startsWith("/accounts"),
  },
];

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
          <img src="/simplepost-logo.png" alt="" className="h-7 w-7 drop-shadow-lg" />
          <span className="hidden font-mono text-sm font-medium tracking-tight text-foreground sm:inline">
            SimplePost
          </span>
        </Link>

        <nav className="ml-1 flex items-center gap-1 sm:ml-3" aria-label="Primary">
          {PRIMARY_NAV.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}>
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-shrink-0 items-center gap-2 sm:gap-3">
          {actions}
          {showCreateCta && (
            <Button asChild size="sm" className="gap-2">
              <Link href="/schedule">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Create post</span>
              </Link>
            </Button>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
