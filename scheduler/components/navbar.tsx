"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { UserMenu } from "@/components/user-menu";

interface NavbarProps {
  actions?: ReactNode;
}

export function Navbar({ actions }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0">
          <img src="/simplepost-logo.png" alt="SimplePost" className="w-7 h-7 drop-shadow-lg" />
          <span className="font-semibold text-foreground hidden sm:inline">SimplePost</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {actions}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
