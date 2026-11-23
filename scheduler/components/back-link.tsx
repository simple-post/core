"use client";

import Link from "next/link";

import { ArrowLeft } from "lucide-react";

import { useUiTranslation } from "@/lib/i18n/client";

interface BackLinkProps {
  href?: string;
  label?: string;
}

export function BackLink({ href = "/", label }: BackLinkProps) {
  const { t } = useUiTranslation();
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-3 w-3 rtl:rotate-180" />
      {label ?? t("backDashboard")}
    </Link>
  );
}
