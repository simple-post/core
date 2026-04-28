import Link from "next/link";

import { ArrowLeft } from "lucide-react";

interface BackLinkProps {
  href?: string;
  label?: string;
}

export function BackLink({ href = "/", label = "Back to dashboard" }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-3 w-3" />
      {label}
    </Link>
  );
}
