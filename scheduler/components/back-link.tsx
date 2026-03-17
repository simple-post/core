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
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
