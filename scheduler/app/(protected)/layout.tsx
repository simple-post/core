"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePathname, useSearchParams } from "next/navigation";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ActivationAnalytics } from "@/components/activation-analytics";
import { SubscriptionGate } from "@/components/billing/subscription-gate";
import { WebMcpProvider } from "@/components/create-post-webmcp";
import { LoginForm } from "@/components/login-form";
import { ScheduleCalendarProvider } from "@/components/schedule-calendar-context";
import { useLoginSession } from "@/lib/auth/use-login-session";
import { useUiTranslation } from "@/lib/i18n/client";
import { SavedUiPreferenceSync } from "@/lib/i18n/saved-preference-sync";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { COMPLIMENTARY_INVITE_STORAGE_KEY } from "@/lib/invites/constants";

async function parseApiError(response: Response, copy: SourceCopy): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || copy("Request failed with status {{status}}", { status: response.status });
}

function InviteRedemptionGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { copy } = useUiCopy();
  const copyRef = useRef(copy);
  useEffect(() => {
    copyRef.current = copy;
  }, [copy]);
  const [redeeming, setRedeeming] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRedeeming(true);

    async function redeemStoredInvite() {
      const copy: SourceCopy = (source, values) => copyRef.current(source, values);
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
          const message = await parseApiError(response, copy);
          if (response.status < 500) {
            window.localStorage.removeItem(COMPLIMENTARY_INVITE_STORAGE_KEY);
          }
          throw new Error(message);
        }

        window.localStorage.removeItem(COMPLIMENTARY_INVITE_STORAGE_KEY);
        if (!cancelled) {
          toast.success(copy("Complimentary access activated"));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : copy("Could not activate complimentary access"));
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
          {copy("Activating complimentary access…")}{" "}
        </div>
      </div>
    );
  }

  return children;
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { t } = useUiTranslation();
  const { data: session, isPending } = useLoginSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const callbackURL = queryString ? `${pathname}?${queryString}` : pathname;

  // Show loading state while checking auth
  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">{t("loading")}</div>
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
      {/* Outside the subscription gate: milestones still relay after a trial ends. */}
      <SavedUiPreferenceSync userId={session.user.id} />
      <ActivationAnalytics />
      <WebMcpProvider key={session.user.id}>
        <ScheduleCalendarProvider>
          <SubscriptionGate>{children}</SubscriptionGate>
        </ScheduleCalendarProvider>
      </WebMcpProvider>
    </InviteRedemptionGate>
  );
}
