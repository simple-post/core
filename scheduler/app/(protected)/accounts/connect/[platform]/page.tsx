"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { AlertCircle } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { HelpLink } from "@/components/help-link";
import { Navbar } from "@/components/navbar";
import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getPlatformById, isSocialPlatformEnabled } from "@/lib/config";
import { platformHelpPath } from "@/lib/docs";
import { useUiTranslation } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

type PendingAccount = {
  id: string;
  name?: string | null;
  username?: string | null;
  profilePicture?: string | null;
};

type PendingConnection = {
  id: string;
  platform: string;
  accounts: PendingAccount[];
};

function pendingError(status: number, fallback: MessageKey): MessageKey {
  if (status === 404) return "pendingConnectionMissing";
  if (status === 410) return "pendingConnectionExpired";
  if (status === 401) return "oauthSessionMismatch";
  return fallback;
}

export default function ConnectAccountPickerPage() {
  const { t } = useUiTranslation();
  const router = useRouter();
  const params = useParams<{ platform: string }>();
  const searchParams = useSearchParams();
  const pendingId = searchParams.get("pendingId");
  const platformId = params.platform;

  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const platformConfig = useMemo(() => getPlatformById(platformId), [platformId]);

  useEffect(() => {
    if (!isSocialPlatformEnabled(platformId)) {
      setError("platformNotEnabled");
      setLoading(false);
      return;
    }
    if (!pendingId) {
      setError("pendingConnectionMissing");
      setLoading(false);
      return;
    }

    const loadPending = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/connect/pending/${pendingId}`);
        if (!response.ok) {
          setError(pendingError(response.status, "pendingConnectionLoadFailed"));
          return;
        }
        const data = (await response.json()) as PendingConnection;
        if (data.platform !== platformId) {
          setError("oauthPlatformMismatch");
          return;
        }
        setPending(data);
        setSelectedIds(data.accounts.map((account) => account.id));
        setError(null);
      } catch {
        setError("pendingConnectionLoadFailed");
      } finally {
        setLoading(false);
      }
    };

    void loadPending();
  }, [pendingId, platformId]);

  const toggleSelection = (accountId: string) => {
    setSelectedIds((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  };

  const selectAll = () => {
    if (!pending) return;
    setSelectedIds(pending.accounts.map((account) => account.id));
  };

  const clearAll = () => {
    setSelectedIds([]);
  };

  const handleSubmit = async () => {
    if (!pendingId) return;
    try {
      setSubmitting(true);
      const response = await fetch(`/api/connect/pending/${pendingId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selectedAccountIds: selectedIds }),
      });

      if (!response.ok) {
        setError(pendingError(response.status, "connectAccountsFailed"));
        return;
      }

      const data = await response.json();
      router.push(
        `/accounts?success=true&platform=${platformId}&count=${data.count || 0}${data.source === "assistant_handoff" ? "&source=assistant_handoff" : ""}`,
      );
    } catch {
      setError("connectAccountsFailed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-12 space-y-4">
          <div className="h-8 bg-secondary rounded w-1/3 animate-pulse" />
          <div className="h-64 bg-secondary rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !pending || !platformConfig) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-12 space-y-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("unableToContinue")}</AlertTitle>
            <AlertDescription>{t(error ?? "pendingConnectionMissing")}</AlertDescription>
          </Alert>
          <HelpLink path={platformHelpPath(platformId)}>{t("connectionHelp")}</HelpLink>
          <Link href="/accounts">
            <Button variant="outline">{t("backToAccounts")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-5xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        <div className="space-y-3">
          <BackLink href="/accounts" label={t("backToAccounts")} />
          <HelpLink path={platformHelpPath(platformId)}>{t("connectionRequirements")}</HelpLink>
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{platformConfig.name}</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              <span className="text-primary">{t("availableAccounts")}</span>
            </h1>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={pending.accounts.length === 0}>
            {t("selectAll")}
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={selectedIds.length === 0}>
            {t("clearSelection")}
          </Button>
        </div>

        <div className="grid gap-2">
          {pending.accounts.map((account) => {
            const isSelected = selectedIds.includes(account.id);
            return (
              <div
                key={account.id}
                className={`rounded-xl border bg-card p-4 transition-colors cursor-pointer ${
                  isSelected ? "border-primary/40" : "border-border hover:border-border"
                }`}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleSelection(account.id)}
                  className="flex w-full items-center gap-4 text-start">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(account.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden">
                      {account.profilePicture ? (
                        <img src={account.profilePicture} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <PlatformIcon platform={platformConfig.id} className="text-lg text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div dir="auto" className="font-medium text-sm">
                        {account.name || account.username || account.id}
                      </div>
                      {account.username && (
                        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-0.5">
                          @{account.username.replace(/^@/, "")}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={() => router.push("/accounts")} disabled={submitting} className="flex-1">
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || selectedIds.length === 0} className="flex-1">
            {submitting ? t("connecting") : t("connectSelectedCount", { count: selectedIds.length })}
          </Button>
        </div>
      </main>
    </div>
  );
}
