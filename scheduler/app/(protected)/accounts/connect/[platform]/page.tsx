"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { AlertCircle } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getPlatformById, isSocialPlatformEnabled } from "@/lib/config";

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

export default function ConnectAccountPickerPage() {
  const router = useRouter();
  const params = useParams<{ platform: string }>();
  const searchParams = useSearchParams();
  const pendingId = searchParams.get("pendingId");
  const platformId = params.platform;

  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformConfig = useMemo(() => getPlatformById(platformId), [platformId]);

  useEffect(() => {
    if (!isSocialPlatformEnabled(platformId)) {
      setError("This social platform is not enabled in this environment.");
      setLoading(false);
      return;
    }
    if (!pendingId) {
      setError("Missing pending connection ID.");
      setLoading(false);
      return;
    }

    const loadPending = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/connect/pending/${pendingId}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load pending connection");
        }
        const data = (await response.json()) as PendingConnection;
        if (data.platform !== platformId) {
          throw new Error("Pending connection does not match the selected platform.");
        }
        setPending(data);
        setSelectedIds(data.accounts.map((account) => account.id));
        setError(null);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : "Failed to load pending connection");
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
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to connect accounts");
      }

      const data = await response.json();
      router.push(`/accounts?success=true&platform=${platformId}&count=${data.count || 0}`);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to connect accounts");
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
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{error || "Pending connection not found."}</AlertDescription>
          </Alert>
          <Link href="/accounts">
            <Button variant="outline">Back to Accounts</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-5xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <BackLink href="/accounts" label="Back to accounts" />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{platformConfig.name}</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Available <span className="text-primary">accounts</span>
            </h1>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={pending.accounts.length === 0}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={selectedIds.length === 0}>
            Clear
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
                  onClick={() => toggleSelection(account.id)}
                  className="flex w-full items-center gap-4 text-left">
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
                      <div className="font-medium text-sm">{account.name || account.username || account.id}</div>
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
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || selectedIds.length === 0} className="flex-1">
            {submitting ? "Connecting..." : `Connect ${selectedIds.length} account(s)`}
          </Button>
        </div>
      </main>
    </div>
  );
}
