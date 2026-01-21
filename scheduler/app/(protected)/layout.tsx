"use client";

import type React from "react";

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

  // Render protected content when authenticated
  return <>{children}</>;
}
