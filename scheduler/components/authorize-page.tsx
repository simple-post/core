"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    const currentUrl = `${config.loginCallbackPath}?${searchParams.toString()}`;
    return <LoginForm callbackURL={currentUrl} />;
  }

  if (!paramsValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-border shadow-2xl bg-card">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Invalid Request</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">{config.invalidMessage}</p>
          </CardContent>
        </Card>
      </div>
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authorize");
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    window.location.href = config.buildCancelUrl(searchParams);
  };

  if (authorized) {
    return (
      <AuthorizeLayout>
        <Card className="border-border shadow-2xl bg-card">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Connected!</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="flex items-center justify-center">
              <svg className="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-muted-foreground">{config.successMessage}</p>
          </CardContent>
        </Card>
      </AuthorizeLayout>
    );
  }

  return (
    <AuthorizeLayout>
      <Card className="border-border shadow-2xl bg-card">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-2xl font-bold">{config.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
              {error}
            </div>
          )}

          <div className="text-center space-y-2">
            <p className="text-muted-foreground">{config.description}</p>
            <div className="bg-muted/50 rounded-lg p-4 mt-4">
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <p className="font-medium text-foreground">{session.user.name || "User"}</p>
              {session.user.email && <p className="text-sm text-muted-foreground">{session.user.email}</p>}
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              This app will be able to view your connected accounts and create posts on your behalf.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleCancel} disabled={isLoading} className="flex-1 h-11">
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={isLoading} className="flex-1 h-11 font-medium shadow-sm">
              {isLoading ? "Authorizing..." : "Approve"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthorizeLayout>
  );
}

function AuthorizeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-10 h-10 drop-shadow-2xl" />
            <h1 className="text-3xl font-bold text-foreground">SimplePost</h1>
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
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      }>
      <AuthorizeContent config={config} />
    </Suspense>
  );
}
