"use client";

import type React from "react";

import { SubscriptionGate } from "@/components/billing/subscription-gate";
import { LoginForm } from "@/components/login-form";
import { useSession } from "@/lib/auth/auth-client";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  // Show loading state while checking auth
  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!session) {
    return <LoginForm />;
  }

  // Render protected content only after subscription status is known.
  return <SubscriptionGate>{children}</SubscriptionGate>;
}
