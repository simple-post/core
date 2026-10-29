"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { AccountAvatar } from "@/components/account-avatar";
import { HelpLink } from "@/components/help-link";
import { Navbar } from "@/components/navbar";
import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountCardView, AccountsHeading, ConnectAccountsEmpty } from "@/components/visual/account-card";
import { useAccounts } from "@/hooks/use-accounts";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { useConnectForem, useDisconnectAccount, useConnectTelegram } from "@/hooks/use-mutations";
import { recoveryReturnPath, resumeRecoveryHref } from "@/lib/accounts/reconnect-navigation";
import { SOCIAL_PLATFORMS, getPlatformById, getAccountDisplayName } from "@/lib/config";
import { platformHelpPath } from "@/lib/docs";
import { logClientError } from "@/lib/logger/client";
import { knownOAuthErrorMessage } from "@/lib/oauth/error-messages";
import { queryKeys } from "@/lib/query-client";
import type { ConnectedAccount } from "@/types";

const CONNECTION_RETURN_KEY = "simplepost:account-connection:return";

function getCredentialBadge(account: ConnectedAccount): {
  className: string;
  label: string;
} | null {
  const status = account.credentialStatus;
  if (!status || status.severity === "ok" || status.state === "refreshing_soon") {
    return null;
  }
  if (status.severity === "error") {
    return {
      className: "border-destructive/20 bg-destructive/10 text-destructive",
      label: status.label,
    };
  }
  return {
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    label: status.label,
  };
}

export default function AccountsPage() {
  const readOnly = useWorkspaceReadOnly();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const handledConnection = useRef(false);
  const onboardingConnection = useRef(false);
  const handledReconnect = useRef(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [recoveryReturnTo, setRecoveryReturnTo] = useState<string | null>(null);
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const disconnectAccountMutation = useDisconnectAccount();
  const connectTelegramMutation = useConnectTelegram();
  const connectForemMutation = useConnectForem();

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState<ConnectedAccount | null>(null);
  const [showTelegramDialog, setShowTelegramDialog] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramChannelName, setTelegramChannelName] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [showForemDialog, setShowForemDialog] = useState(false);
  const [foremInstance, setForemInstance] = useState("https://dev.to");
  const [foremApiKey, setForemApiKey] = useState("");
  const [foremError, setForemError] = useState("");

  // OAuth and manual connections share a quiet hand-off to the dashboard.
  useEffect(() => {
    if (searchParams.get("success") !== "true") {
      handledConnection.current = false;
      return;
    }
    if (handledConnection.current) return;
    handledConnection.current = true;
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
    let destination = "/accounts";
    try {
      destination = recoveryReturnPath(window.sessionStorage.getItem(CONNECTION_RETURN_KEY)) ?? "/accounts";
      window.sessionStorage.removeItem(CONNECTION_RETURN_KEY);
    } catch {
      // Storage can be unavailable; connection success must still be usable.
    }
    toast.success("Account connected");
    router.replace(resumeRecoveryHref(destination), { scroll: false });
  }, [queryClient, router, searchParams]);

  useEffect(() => {
    if (!searchParams.get("error")) return;
    setConnectionError(
      knownOAuthErrorMessage(searchParams.get("error")) ??
        "Your account connection did not finish. Try reconnecting again. Your saved work is still here.",
    );
    try {
      setRecoveryReturnTo(recoveryReturnPath(window.sessionStorage.getItem(CONNECTION_RETURN_KEY)));
    } catch {
      /* The account list remains usable without storage. */
    }
  }, [searchParams]);

  // Direct hand-off from the checklist or an assistant: open the platform picker.
  useEffect(() => {
    if (readOnly || searchParams.get("onboarding") !== "connect" || searchParams.get("success") === "true") return;
    onboardingConnection.current = true;
    setShowConnectDialog(true);
    router.replace("/accounts", { scroll: false });
  }, [readOnly, router, searchParams]);

  const handleConnect = useCallback(
    (platform: string, returnTo?: string) => {
      if (readOnly) return;
      const platformConfig = getPlatformById(platform);
      // Preserve the return destination through the provider's full-page OAuth navigation.
      // Reconnects and additional accounts stay on Accounts so their status is visible.
      try {
        window.sessionStorage.setItem(
          CONNECTION_RETURN_KEY,
          recoveryReturnPath(returnTo) ??
            recoveryReturnTo ??
            (onboardingConnection.current || (!loading && accounts.length === 0) ? "/" : "/accounts"),
        );
      } catch {
        // Do not block account connection when storage is disabled.
      }

      if (platformConfig?.connectionType === "manual") {
        setShowConnectDialog(false);
        if (platform === "forem") {
          setShowForemDialog(true);
          setForemError("");
        } else {
          setShowTelegramDialog(true);
          setTelegramError("");
        }
      } else {
        setShowConnectDialog(false);
        window.location.href = `/api/connect/${platform}`;
      }
    },
    [readOnly, loading, accounts.length, recoveryReturnTo],
  );

  useEffect(() => {
    const accountId = searchParams.get("reconnect");
    if (readOnly || loading || !accountId || handledReconnect.current) return;
    const account = accounts.find((entry) => entry.id === accountId);
    handledReconnect.current = true;
    if (account) handleConnect(account.platform, recoveryReturnPath(searchParams.get("returnTo")) ?? "/accounts");
    else {
      setConnectionError("This account is no longer connected. Your post is still saved.");
      setRecoveryReturnTo(recoveryReturnPath(searchParams.get("returnTo")));
    }
  }, [accounts, handleConnect, loading, readOnly, searchParams]);
  const closeForemDialog = () => {
    setShowForemDialog(false);
    setForemApiKey("");
    setForemError("");
  };

  const handleForemConnect = async () => {
    if (!foremInstance.trim() || !foremApiKey.trim()) {
      setForemError("Please provide the instance URL and API key");
      return;
    }
    if (!/^https:\/\//i.test(foremInstance.trim())) {
      setForemError("The instance URL must start with https://");
      return;
    }
    setForemError("");
    try {
      await connectForemMutation.mutateAsync({ instanceUrl: foremInstance.trim(), apiKey: foremApiKey.trim() });
      closeForemDialog();
      // Reuse the OAuth success hand-off for manual connections.
      router.replace("/accounts?success=true&platform=forem", { scroll: false });
    } catch (error) {
      logClientError(error, "Forem connection error");
      setForemError(error instanceof Error ? error.message : "Failed to connect Forem");
    }
  };

  const handleTelegramConnect = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      setTelegramError("Please provide both bot token and chat ID");
      return;
    }

    setTelegramError("");

    try {
      await connectTelegramMutation.mutateAsync({
        botToken: telegramBotToken.trim(),
        chatId: telegramChatId.trim(),
        channelName: telegramChannelName.trim() || undefined,
      });

      setShowTelegramDialog(false);
      setTelegramBotToken("");
      setTelegramChatId("");
      setTelegramChannelName("");
      router.replace("/accounts?success=true&platform=telegram", { scroll: false });
    } catch (error) {
      logClientError(error, "Telegram connection error");
      setTelegramError(error instanceof Error ? error.message : "Failed to connect Telegram account");
    }
  };

  const handleDisconnectClick = (account: ConnectedAccount) => {
    setAccountToDisconnect(account);
    setShowDisconnectDialog(true);
  };

  const handleDisconnectConfirm = async () => {
    if (!accountToDisconnect) return;

    try {
      await disconnectAccountMutation.mutateAsync(accountToDisconnect.id);
      setShowDisconnectDialog(false);
      setAccountToDisconnect(null);
    } catch (error) {
      logClientError(error, "Disconnect error", { accountId: accountToDisconnect.id });
      toast.error("An error occurred while disconnecting the account.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        {connectionError && (
          <Alert variant="destructive" className="mb-4" role="alert">
            <AlertDescription className="space-y-3">
              <p>{connectionError}</p>
              {recoveryReturnTo && recoveryReturnTo !== "/accounts" && (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={resumeRecoveryHref(recoveryReturnTo)}
                    onClick={() => {
                      try {
                        window.sessionStorage.removeItem(CONNECTION_RETURN_KEY);
                      } catch {
                        /* No storage means no retained return destination. */
                      }
                    }}>
                    {recoveryReturnTo === "/" ? "Back to dashboard" : "Back to your post"}
                  </Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <AccountsHeading
          action={
            readOnly ? undefined : (
              <Button onClick={() => setShowConnectDialog(true)} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                <span>Connect account</span>
              </Button>
            )
          }
        />
        <HelpLink path="/accounts" className="mb-4">
          Connection and account requirements
        </HelpLink>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-secondary rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-secondary rounded w-1/3" />
                    <div className="h-3 bg-secondary rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <ConnectAccountsEmpty
            action={
              readOnly ? undefined : (
                <Button onClick={() => setShowConnectDialog(true)}>
                  <Plus className="h-4 w-4" />
                  Connect your first account
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-3 animate-reveal animate-reveal-delay-1">
            {accounts.map((account: ConnectedAccount) => {
              const platformConfig = getPlatformById(account.platform);
              if (!platformConfig) return null;
              const credentialBadge = getCredentialBadge(account);

              return (
                <AccountCardView
                  key={account.id}
                  avatar={
                    <AccountAvatar
                      accountId={account.id}
                      avatarVersion={account.updatedAt}
                      profilePicture={account.profilePicture}
                      platform={platformConfig.id}
                      size="lg"
                    />
                  }
                  name={getAccountDisplayName(account)}
                  platform={platformConfig.name}
                  connectedAt={new Date(account.createdAt).toLocaleDateString()}
                  health={
                    credentialBadge ? (
                      <span
                        className={`inline-flex w-fit shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${credentialBadge.className}`}>
                        {credentialBadge.label}
                      </span>
                    ) : null
                  }
                  help={
                    <HelpLink path={platformHelpPath(account.platform)} className="mt-2">
                      Connection help
                    </HelpLink>
                  }
                  details={
                    <>
                      {account.email && <p className="text-xs text-muted-foreground mt-1 truncate">{account.email}</p>}
                      {credentialBadge && account.credentialStatus && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                          {account.credentialStatus.message}
                        </p>
                      )}
                      {account.credentialStatus?.state === "reauth_required" && (
                        <p role="status" className="text-xs text-destructive mt-1 max-w-xl">
                          {(account.credentialStatus.affectedQueuedPosts ?? 0) > 0
                            ? `${account.credentialStatus.affectedQueuedPosts} queued ${account.credentialStatus.affectedQueuedPosts === 1 ? "post needs" : "posts need"} this connection. Reconnect before the next scheduled post.`
                            : "Reconnect before publishing again."}{" "}
                          Failed posts must be rescheduled separately.
                        </p>
                      )}
                    </>
                  }
                  actions={
                    readOnly ? undefined : (
                      <>
                        {" "}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnect(account.platform)}
                          className="gap-1.5">
                          <RefreshCw className="h-3 w-3" />
                          <span className="hidden sm:inline">Reconnect</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnectClick(account)}
                          className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/40">
                          <X className="h-3 w-3" />
                          <span className="hidden sm:inline">Disconnect</span>
                        </Button>
                      </>
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Platform Selector Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Connect</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">New account</DialogTitle>
            <DialogDescription>
              Pick a platform to connect. You can connect multiple accounts from the same platform.
            </DialogDescription>
          </DialogHeader>
          <HelpLink path="/accounts#platform-requirements">Check platform requirements</HelpLink>
          <div className="grid gap-2 sm:grid-cols-2 mt-4">
            {SOCIAL_PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                onClick={() => handleConnect(platform.id)}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-secondary transition-colors text-left group cursor-pointer">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg flex-shrink-0 ${
                    platform.id === "youtube" ? "bg-white text-red-600" : `${platform.color} text-white`
                  }`}>
                  <PlatformIcon platform={platform.id} className="!h-8 !w-8" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-medium text-sm text-foreground truncate">{platform.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{platform.description}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showForemDialog} onOpenChange={(open) => (open ? setShowForemDialog(true) : closeForemDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">DEV/Forem</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">Connect DEV/Forem</DialogTitle>
            <DialogDescription>Use an API key from your Forem account settings.</DialogDescription>
            <HelpLink path="/forem">Forem setup guide</HelpLink>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {foremError && (
              <Alert variant="destructive">
                <AlertDescription>{foremError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label
                htmlFor="foremInstance"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Instance URL
              </Label>
              <Input
                id="foremInstance"
                placeholder="https://dev.to"
                value={foremInstance}
                onChange={(e) => setForemInstance(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Keep https://dev.to for DEV Community, or point at your own Forem.
              </p>
            </div>
            <div>
              <Label
                htmlFor="foremApiKey"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                API key
              </Label>
              <Input
                id="foremApiKey"
                type="password"
                value={foremApiKey}
                onChange={(e) => setForemApiKey(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                For DEV, generate a dedicated key under Settings → Extensions → DEV Community API Keys. Revoke it there
                when no longer needed.
              </p>
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <Button
              variant="outline"
              onClick={closeForemDialog}
              disabled={connectForemMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleForemConnect} disabled={connectForemMutation.isPending} className="flex-1">
              <span>{connectForemMutation.isPending ? "Connecting..." : "Connect"}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl tracking-tight">Disconnect account</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {accountToDisconnect && (
            <div className="py-2">
              <div className="flex items-center gap-3 p-3 bg-secondary border border-border rounded-lg">
                {(() => {
                  const platformConfig = getPlatformById(accountToDisconnect.platform);
                  return platformConfig ? (
                    <>
                      <AccountAvatar
                        accountId={accountToDisconnect.id}
                        avatarVersion={accountToDisconnect.updatedAt}
                        profilePicture={accountToDisconnect.profilePicture}
                        platform={platformConfig.id}
                        size="md"
                      />
                      <div>
                        <p className="font-medium text-sm">{getAccountDisplayName(accountToDisconnect)}</p>
                        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-0.5">
                          {platformConfig.name}
                        </p>
                      </div>
                    </>
                  ) : null;
                })()}
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={disconnectAccountMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnectConfirm}
              disabled={disconnectAccountMutation.isPending}
              className="flex-1">
              <span>{disconnectAccountMutation.isPending ? "Disconnecting..." : "Disconnect"}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Telegram Connection Dialog */}
      <Dialog open={showTelegramDialog} onOpenChange={setShowTelegramDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Telegram</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">Connect Telegram</DialogTitle>
            <DialogDescription>Provide your bot token and chat ID to publish to a channel or group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {telegramError && (
              <Alert variant="destructive">
                <AlertDescription>{telegramError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label
                htmlFor="botToken"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Bot token
              </Label>
              <Input
                id="botToken"
                type="text"
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Get this from{" "}
                <a
                  href="https://t.me/botfather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground">
                  @BotFather
                </a>
                .
              </p>
            </div>
            <div>
              <Label
                htmlFor="chatId"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Chat ID
              </Label>
              <Input
                id="chatId"
                type="text"
                placeholder="-1001234567890"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Channel or group ID. Use{" "}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground">
                  @userinfobot
                </a>{" "}
                to find it.
              </p>
            </div>
            <div>
              <Label
                htmlFor="channelName"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Channel name <span className="text-[#555555] normal-case font-sans">(optional)</span>
              </Label>
              <Input
                id="channelName"
                type="text"
                placeholder="My Channel"
                value={telegramChannelName}
                onChange={(e) => setTelegramChannelName(e.target.value)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1.5">A friendly label to identify this channel.</p>
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowTelegramDialog(false);
                setTelegramBotToken("");
                setTelegramChatId("");
                setTelegramChannelName("");
                setTelegramError("");
              }}
              disabled={connectTelegramMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleTelegramConnect} disabled={connectTelegramMutation.isPending} className="flex-1">
              <span>{connectTelegramMutation.isPending ? "Connecting..." : "Connect"}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
