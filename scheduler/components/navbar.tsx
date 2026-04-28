"use client";

import { useEffect, useState, type ReactNode } from "react";

import Link from "next/link";

import { UserMenu } from "@/components/user-menu";

interface NavbarProps {
  actions?: ReactNode;
}

export function Navbar({ actions }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-background/80 backdrop-blur-[10px] transition-all duration-200 ${
        scrolled ? "border-b border-border" : ""
      }`}>
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0">
          <img src="/simplepost-logo.png" alt="SimplePost" className="w-7 h-7 drop-shadow-lg" />
          <span className="font-mono text-sm font-medium text-foreground hidden sm:inline tracking-tight">
            SimplePost
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {actions}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
