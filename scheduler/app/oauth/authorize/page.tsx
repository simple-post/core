"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth/auth-client";

function AuthorizeContent() {
  const { data: session, isPending } = useSession();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");

  const paramsValid = !!(clientId && redirectUri && state && codeChallenge);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <LoginForm />;
  }

  if (!paramsValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-border shadow-2xl bg-card">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Invalid Request</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">
              This authorization link is invalid or has expired. Please try connecting again from your
              AI assistant.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleApprove = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod || "S256",
          scope,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error_description || data.error || `Failed to authorize (${res.status})`);
      }

      const { redirectUrl } = await res.json();
      window.location.href = redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authorize");
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    const redirect = new URL(redirectUri!);
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("state", state!);
    window.location.href = redirect.toString();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-10 h-10 drop-shadow-2xl" />
            <h1 className="text-3xl font-bold text-foreground">SimplePost</h1>
          </div>
        </div>

        <Card className="border-border shadow-2xl bg-card">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Authorize App</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                {error}
              </div>
            )}

            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                An application is requesting access to your SimplePost account.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 mt-4">
                <p className="text-sm text-muted-foreground">Signed in as</p>
                <p className="font-medium text-foreground">{session.user.name || "User"}</p>
                {session.user.email && (
                  <p className="text-sm text-muted-foreground">{session.user.email}</p>
                )}
              </div>
              <p className="text-sm text-muted-foreground pt-2">
                This app will be able to view your connected accounts and create posts on your behalf.
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading}
                className="flex-1 h-11"
              >
                Cancel
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isLoading}
                className="flex-1 h-11 font-medium shadow-sm"
              >
                {isLoading ? "Authorizing..." : "Approve"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <AuthorizeContent />
    </Suspense>
  );
}
