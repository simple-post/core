"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { ChevronRight } from "lucide-react";

import { UserMenu } from "@/components/user-menu";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

interface NavbarProps {
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}

export function Navbar({ breadcrumbs, actions }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1.5 min-w-0">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0">
            <img src="/simplepost-logo.png" alt="SimplePost" className="w-7 h-7 drop-shadow-lg" />
            {!breadcrumbs?.length && (
              <span className="font-semibold text-foreground hidden sm:inline">SimplePost</span>
            )}
          </Link>
          {breadcrumbs?.map((item, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={index} className="flex items-center gap-1.5 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                {isLast || !item.href ? (
                  <span className="font-medium text-foreground truncate">{item.label}</span>
                ) : (
                  <Link
                    href={item.href}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate">
                    {item.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {actions}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
