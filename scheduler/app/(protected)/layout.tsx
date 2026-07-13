"use client";

import { useEffect, useState, type ReactNode } from "react";

import { usePathname, useSearchParams } from "next/navigation";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SubscriptionGate } from "@/components/billing/subscription-gate";
import { LoginForm } from "@/components/login-form";
import { useSession } from "@/lib/auth/auth-client";
import { COMPLIMENTARY_INVITE_STORAGE_KEY } from "@/lib/invites/constants";

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

function InviteRedemptionGate({ userId, children }: { userId: string; children: ReactNode }) {
  const [redeeming, setRedeeming] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRedeeming(true);

    async function redeemStoredInvite() {
      const code = window.localStorage.getItem(COMPLIMENTARY_INVITE_STORAGE_KEY);
      if (!code) {
        setRedeeming(false);
        return;
      }

      try {
        const response = await fetch("/api/invites/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          const message = await parseApiError(response);
          if (response.status < 500) {
            window.localStorage.removeItem(COMPLIMENTARY_INVITE_STORAGE_KEY);
          }
          throw new Error(message);
        }

        window.localStorage.removeItem(COMPLIMENTARY_INVITE_STORAGE_KEY);
        if (!cancelled) {
          toast.success("Complimentary access activated");
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Could not activate complimentary access");
        }
      } finally {
        if (!cancelled) {
          setRedeeming(false);
        }
      }
    }

    void redeemStoredInvite();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (redeeming) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Activating complimentary access…
        </div>
      </div>
    );
  }

  return children;
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const callbackURL = queryString ? `${pathname}?${queryString}` : pathname;

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
    return <LoginForm callbackURL={callbackURL} />;
  }

  // Render protected content only after subscription status is known.
  return (
    <InviteRedemptionGate userId={session.user.id}>
      <SubscriptionGate>{children}</SubscriptionGate>
    </InviteRedemptionGate>
  );
}
