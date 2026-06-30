import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
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
          Page <span className="text-primary">not found</span>
        </h2>
        <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
