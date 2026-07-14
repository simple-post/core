"use client";

import { useState } from "react";

import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { AccountAvatar } from "@/components/account-avatar";
import { Navbar } from "@/components/navbar";
import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import {
  useConnectFarcaster,
  useConnectForem,
  useDisconnectAccount,
  useConnectTelegram,
  usePrepareFarcaster,
} from "@/hooks/use-mutations";
import { SOCIAL_PLATFORMS, getPlatformById, getAccountDisplayName } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import type { ConnectedAccount } from "@/types";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getEthereumProvider(): EthereumProvider | null {
  return (window as typeof window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

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
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const disconnectAccountMutation = useDisconnectAccount();
  const connectTelegramMutation = useConnectTelegram();
  const connectForemMutation = useConnectForem();
  const prepareFarcasterMutation = usePrepareFarcaster();
  const connectFarcasterMutation = useConnectFarcaster();

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
  const [showFarcasterDialog, setShowFarcasterDialog] = useState(false);
  const [farcasterError, setFarcasterError] = useState("");

  const handleConnect = (platform: string) => {
    const platformConfig = getPlatformById(platform);

    if (platformConfig?.connectionType === "manual") {
      setShowConnectDialog(false);
      if (platform === "forem") {
        setShowForemDialog(true);
        setForemError("");
      } else if (platform === "farcaster") {
        setShowFarcasterDialog(true);
        setFarcasterError("");
      } else {
        setShowTelegramDialog(true);
        setTelegramError("");
      }
    } else {
      setShowConnectDialog(false);
      window.location.href = `/api/connect/${platform}`;
    }
  };
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
    } catch (error) {
      logClientError(error, "Forem connection error");
      setForemError(error instanceof Error ? error.message : "Failed to connect Forem");
    }
  };

  const closeFarcasterDialog = () => {
    setShowFarcasterDialog(false);
    setFarcasterError("");
  };

  const handleFarcasterConnect = async () => {
    setFarcasterError("");
    try {
      const provider = getEthereumProvider();
      if (!provider)
        throw new TypeError("No Ethereum wallet was found. Install or open a wallet that controls your FID.");

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
        throw new TypeError("The wallet did not return an Ethereum account");
      }
      const prepared = await prepareFarcasterMutation.mutateAsync({ custodyAddress: accounts[0] });
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [prepared.custodyAddress, JSON.stringify(prepared.typedData)],
      });
      if (typeof signature !== "string") throw new Error("The wallet did not return a signer authorization");

      await connectFarcasterMutation.mutateAsync({ requestToken: prepared.requestToken, custodySignature: signature });
      closeFarcasterDialog();
    } catch (error) {
      logClientError(error, "Farcaster connection error");
      setFarcasterError(error instanceof Error ? error.message : "Failed to connect Farcaster");
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
      toast.error(error instanceof Error ? error.message : "An error occurred while disconnecting the account.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 flex items-center justify-between gap-3 animate-reveal">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Accounts</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Connected <span className="text-primary">accounts</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowConnectDialog(true)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Connect account</span>
            </Button>
          </div>
        </div>

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
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center animate-reveal animate-reveal-delay-1">
            <div className="w-12 h-12 mx-auto rounded-lg border border-border bg-secondary flex items-center justify-center mb-5">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1.5">No accounts connected</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Connect your first social media account to start scheduling and publishing posts.
            </p>
            <Button onClick={() => setShowConnectDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Connect your first account
            </Button>
          </div>
        ) : (
          <div className="space-y-3 animate-reveal animate-reveal-delay-1">
            {accounts.map((account: ConnectedAccount) => {
              const platformConfig = getPlatformById(account.platform);
              if (!platformConfig) return null;
              const credentialBadge = getCredentialBadge(account);

              return (
                <div key={account.id} className="rounded-2xl border border-border bg-card p-5 card-accent-hover">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <AccountAvatar
                        accountId={account.id}
                        avatarVersion={account.updatedAt}
                        profilePicture={account.profilePicture}
                        platform={platformConfig.id}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base text-foreground truncate">
                            {getAccountDisplayName(account)}
                          </h3>
                          {credentialBadge ? (
                            <span
                              className={`inline-flex w-fit shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${credentialBadge.className}`}>
                              {credentialBadge.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          <span>{platformConfig.name}</span>
                          <span className="text-[#555555]">·</span>
                          <span>Connected {new Date(account.createdAt).toLocaleDateString()}</span>
                        </div>
                        {account.email && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{account.email}</p>
                        )}
                        {credentialBadge && account.credentialStatus && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                            {account.credentialStatus.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
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
                    </div>
                  </div>
                </div>
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
              {connectForemMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showFarcasterDialog}
        onOpenChange={(open) => (open ? setShowFarcasterDialog(true) : closeFarcasterDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Farcaster</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">Connect Farcaster</DialogTitle>
            <DialogDescription>
              Authorize a dedicated, cast-only signer with the Ethereum wallet that owns your FID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {farcasterError && (
              <Alert variant="destructive">
                <AlertDescription>{farcasterError}</AlertDescription>
              </Alert>
            )}
            <Alert>
              <AlertDescription>
                SimplePost will ask for one EIP-712 signature. It cannot move funds or change custody. The generated
                signer can only publish and delete casts, expires after inactivity, and is encrypted at rest.
              </AlertDescription>
            </Alert>
            <p className="text-xs text-muted-foreground">
              Use the current custody wallet for the FID you want to connect. Smart-contract custody wallets are not
              supported by Farcaster&apos;s May 2026 signer protocol.
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <Button
              variant="outline"
              onClick={closeFarcasterDialog}
              disabled={prepareFarcasterMutation.isPending || connectFarcasterMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleFarcasterConnect}
              disabled={prepareFarcasterMutation.isPending || connectFarcasterMutation.isPending}
              className="flex-1">
              {prepareFarcasterMutation.isPending || connectFarcasterMutation.isPending
                ? "Authorizing..."
                : "Connect custody wallet"}
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
              {disconnectAccountMutation.isPending ? "Disconnecting..." : "Disconnect"}
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
              {connectTelegramMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
