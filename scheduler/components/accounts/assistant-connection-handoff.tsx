"use client";

import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";

import { CheckCircle2, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { useUiTranslation } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

export function AssistantConnectionHandoff({ onManual }: { onManual: (platform: string, token: string) => void }) {
  const { t } = useUiTranslation();
  const query = useSearchParams();
  const platform = query.get("platform");
  const token = query.get("handoffToken");
  const complete = query.get("source") === "assistant_handoff" && query.get("success") === "true";
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
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
          const mismatch = result.code === "HANDOFF_ACCOUNT_MISMATCH";
          setWrongAccount(mismatch);
          setError(mismatch ? "handoffAccountMismatch" : "returnFreshLink");
          return;
        }
        if (result.connectionType === "manual") {
          setManual(true);
          onManual(platform!, token!);
        } else window.location.replace(result.startUrl);
      } catch {
        if (!controller.signal.aborted) setError("handoffTryAgain");
      }
    }
    void start();
    return () => controller.abort();
  }, [platform, token, complete, onManual]);

  if (complete)
    return (
      <Alert className="mb-6 border-primary/25 bg-primary/5">
        <CheckCircle2 className="size-4 text-primary" />
        <AlertTitle className="line-clamp-none">{t("handoffComplete")}</AlertTitle>
        <AlertDescription>{t("handoffCompleteDetails")}</AlertDescription>
      </Alert>
    );
  if (!platform || !token) return null;
  if (error)
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertTitle className="line-clamp-none">{t("handoffCouldNotStart")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t(error)}</p>
          {wrongAccount && (
            <Button
              variant="outline"
              size="sm"
              disabled={switchingAccount}
              onClick={async () => {
                setSwitchingAccount(true);
                try {
                  const result = await authClient.signOut();
                  if (result.error) throw result.error;
                  window.location.reload();
                } catch {
                  setError("signOutFailed");
                  setSwitchingAccount(false);
                }
              }}>
              {switchingAccount ? t("signingOut") : t("useAnotherSimplePostAccount")}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  if (manual)
    return (
      <Button variant="outline" className="mb-6" onClick={() => onManual(platform, token)}>
        {t("continueAccountSetup")}
      </Button>
    );
  return (
    <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {t("startingAccountConnection")}
    </p>
  );
}
