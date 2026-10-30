"use client";

import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";

import { CheckCircle2, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";

export function AssistantConnectionHandoff({ onManual }: { onManual: (platform: string, token: string) => void }) {
  const query = useSearchParams();
  const platform = query.get("platform");
  const token = query.get("handoffToken");
  const complete = query.get("source") === "assistant_handoff" && query.get("success") === "true";
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongAccount, setWrongAccount] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  useEffect(() => {
    if (!platform || !token || complete) return;
    const controller = new AbortController();
    setError(null);
    setManual(false);
    setWrongAccount(false);
    async function start() {
      try {
        const response = await fetch("/api/connect/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, handoffToken: token }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setWrongAccount(result.code === "HANDOFF_ACCOUNT_MISMATCH");
          throw new Error(
            result.error || "The connection could not start. Return to your AI assistant for a new link.",
          );
        }
        if (result.connectionType === "manual") {
          setManual(true);
          onManual(platform!, token!);
        } else window.location.replace(result.startUrl);
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error ? error_.message : "The connection could not start. Try opening the link again.",
          );
      }
    }
    void start();
    return () => controller.abort();
  }, [platform, token, complete, onManual]);

  if (complete)
    return (
      <Alert className="mb-6 border-primary/25 bg-primary/5">
        <CheckCircle2 className="size-4 text-primary" />
        <AlertTitle className="line-clamp-none">Account connected. Continue in your AI assistant.</AlertTitle>
        <AlertDescription>
          Return to the conversation where you opened this link and say “connected”. Your assistant will check your
          accounts and help you prepare your post.
        </AlertDescription>
      </Alert>
    );
  if (!platform || !token) return null;
  if (error)
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertTitle className="line-clamp-none">Connection could not start</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error}</p>
          {wrongAccount && (
            <Button
              variant="outline"
              size="sm"
              disabled={switchingAccount}
              onClick={async () => {
                setSwitchingAccount(true);
                try {
                  const result = await authClient.signOut();
                  if (result.error) throw new Error("Could not sign out. Please try again.");
                  window.location.reload();
                } catch {
                  setError("Could not sign out. Please try again.");
                  setSwitchingAccount(false);
                }
              }}>
              {switchingAccount ? "Signing out…" : "Use a different SimplePost account"}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  if (manual)
    return (
      <Button variant="outline" className="mb-6" onClick={() => onManual(platform, token)}>
        Continue account setup
      </Button>
    );
  return (
    <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Starting your account connection…
    </p>
  );
}
