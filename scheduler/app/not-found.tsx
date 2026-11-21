import Link from "next/link";

import { Button } from "@/components/ui/button";
import { UiCopy } from "@/components/ui-copy";
import { getUiCopy } from "@/lib/i18n/request-copy";

export default async function NotFound() {
  const { copy } = await getUiCopy();
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden p-6">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div className="relative text-center space-y-4 animate-reveal">
        <div className="section-kicker justify-center">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">404</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground">
          <UiCopy source="Page <part1>not found</part1>" components={{ part1: <span className="text-primary" /> }} />
        </h2>
        <p className="text-sm text-muted-foreground">{copy("The page you're looking for doesn't exist.")}</p>
        <Button asChild>
          <Link href="/">{copy("Go home")}</Link>
        </Button>
      </div>
    </div>
  );
}
