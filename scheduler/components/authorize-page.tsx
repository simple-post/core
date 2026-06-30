"use client";

import { Suspense, useState } from "react";

import { useSearchParams } from "next/navigation";

import { Check } from "lucide-react";

import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth-client";

interface AuthorizePageConfig {
  title: string;
  description: string;
  invalidMessage: React.ReactNode;
  successMessage: string;
  loginCallbackPath: string;
  validateParams: (searchParams: URLSearchParams) => boolean;
  authorize: (searchParams: URLSearchParams) => Promise<Response>;
  buildCancelUrl: (searchParams: URLSearchParams) => string;
}

function AuthorizeContent({ config }: { config: AuthorizePageConfig }) {
  const { data: session, isPending } = useSession();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paramsValid = config.validateParams(searchParams);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!session) {
    const currentUrl = `${config.loginCallbackPath}?${searchParams.toString()}`;
    return <LoginForm callbackURL={currentUrl} />;
  }

  if (!paramsValid) {
    return (
      <AuthorizeLayout>
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-2xl">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Authorize</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground mb-2">Invalid request</h2>
          <p className="text-sm text-muted-foreground">{config.invalidMessage}</p>
        </div>
      </AuthorizeLayout>
    );
  }

  const handleApprove = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await config.authorize(searchParams);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error_description || data.error || `Failed to authorize (${res.status})`);
      }

      const { redirectUrl } = await res.json();
      setAuthorized(true);
      window.location.href = redirectUrl;
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to authorize");
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    window.location.href = config.buildCancelUrl(searchParams);
  };

  if (authorized) {
    return (
      <AuthorizeLayout>
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-2xl text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-4">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground mb-2">Connected</h2>
          <p className="text-sm text-muted-foreground">{config.successMessage}</p>
        </div>
      </AuthorizeLayout>
    );
  }

  return (
    <AuthorizeLayout>
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-2xl">
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Authorize</span>
        </div>
        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground mb-2">{config.title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{config.description}</p>

        {error && (
          <div className="p-3 mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border bg-secondary/40 p-4 mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Signed in as</p>
          <p className="font-medium text-foreground text-sm">{session.user.name || "User"}</p>
          {session.user.email && <p className="text-xs text-muted-foreground mt-0.5">{session.user.email}</p>}
        </div>

        <div className="space-y-3 mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            This app will be able to
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              "View connected social accounts",
              "Validate draft post text against platform rules",
              "Create or schedule posts after you approve the tool call",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            Publishing now creates public content on the selected platforms. Review the tool-call details before
            approving.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleApprove} disabled={isLoading} className="flex-1">
            {isLoading ? "Authorizing…" : "Approve"}
          </Button>
        </div>
      </div>
    </AuthorizeLayout>
  );
}

function AuthorizeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-6 overflow-hidden">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div className="relative w-full max-w-md animate-reveal">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3">
            <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-9 h-9 drop-shadow-2xl" />
            <span className="font-mono text-base font-medium text-muted-foreground tracking-tight">SimplePost</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthorizePage({ config }: { config: AuthorizePageConfig }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Loading…</div>
        </div>
      }>
      <AuthorizeContent config={config} />
    </Suspense>
  );
}
